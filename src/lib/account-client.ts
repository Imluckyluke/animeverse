/**
 * Same-origin client for the real account API (HttpOnly cookie sessions).
 *
 * Security rules kept in this module:
 * - No token, cookie or password is ever written to storage; the browser only
 *   holds the server's HttpOnly session cookie and a short-lived CSRF string in
 *   memory.
 * - `av_user` / `av_accounts` from the old local demo accounts are read-only
 *   historical data: never trusted as server identities, never rewritten, never
 *   deleted (their hashes/passwords must not leave the device either).
 * - Everything persisted here is non-secret: guest preferences, one legacy
 *   backup (public profile + preferences) and pending per-key operations keyed
 *   by the server `user.id`.
 * - Nothing is logged: request bodies, passwords and cookies stay in memory.
 */
import { LIBRARY_STATUSES, parseLibrary, type LibraryState, type LibraryStatus } from "@/lib/library";

/* ── Contract constants ─────────────────────────────────────────────────── */

export const ACCOUNT_API_BASE = "/api/account";
/** The server accepts at most 100 operations per call. */
export const MAX_OPERATIONS_PER_CALL = 100;
/** Initial session probe is aborted inside this window (8–10s contract). */
export const SESSION_TIMEOUT_MS = 9000;
export const REQUEST_TIMEOUT_MS = 15000;
/** Safety valve for a stuck queue; unreachable in normal use. */
export const MAX_PENDING_OPERATIONS = 5000;
/** Safety valve for the explicit local→cloud import. */
export const MAX_IMPORT_OPERATIONS = 10000;

export const ACCOUNT_STORAGE = {
  /** Old local demo profile. Preserved byte-for-byte; never an identity. */
  legacyUser: "av_user",
  legacyFavorites: "av_favorites",
  legacyWatched: "av_watched",
  legacyLibrary: "av_library",
  /** One non-secret backup (no hashes, no passwords, no tokens). */
  backup: "av_legacy_backup",
  backupImportedAt: "av_legacy_backup_imported_at",
  guestFavorites: "av_guest_favorites",
  guestWatched: "av_guest_watched",
  guestLibrary: "av_guest_library",
} as const;

export const PENDING_OPERATION_KEY_PREFIX = "av_pending_ops_";

/* ── Types ──────────────────────────────────────────────────────────────── */

export type AccountRole = "user" | "owner" | "editor" | "reviewer";

export type AccountUser = {
  id: string;
  name: string;
  email: string;
  joinedAt: string;
  /** Server-assigned. The API is authoritative — never the local email. */
  role?: AccountRole;
};

export type Preferences = {
  favorites: string[];
  watched: Record<string, number[]>;
  library: LibraryState;
};

export type AccountPreferences = Preferences & { revision: number };

export type AccountSession = {
  user: AccountUser | null;
  csrf: string;
  preferences: AccountPreferences | null;
};

export type PreferenceOperation =
  | { id: string; type: "favorite"; slug: string; value: boolean }
  | { id: string; type: "watched"; slug: string; episode: number; value: boolean }
  | { id: string; type: "library"; slug: string; value: LibraryStatus | null }
  | { id: string; type: "clear-favorites" };

export type LegacyBackup = {
  createdAt: string;
  user: { name: string; email: string; joinedAt: string } | null;
  preferences: Preferences;
};

/* ── Errors ─────────────────────────────────────────────────────────────── */

/** A parsed, user-facing failure. The message is always Persian prose. */
export class AccountApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "AccountApiError";
    this.status = status;
  }
}

export function isAbortError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && (error as { name?: string }).name === "AbortError",
  );
}

/** Persian, user-facing text only: never a stack trace, header or body. */
export function accountErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AccountApiError) {
    const message = error.message.trim();
    if (message) return message;
  }
  if (isAbortError(error)) return "درخواست ناتمام ماند؛ دوباره تلاش کن.";
  return fallback;
}

function errorMessageFor(status: number, payload: unknown): string {
  const record = asRecord(payload);
  const serverMessage = typeof record?.error === "string" ? record.error.trim() : "";
  if (serverMessage) return serverMessage.slice(0, 300);
  if (status === 400 || status === 422) return "اطلاعات واردشده معتبر نیست؛ فرم را بررسی کن.";
  if (status === 401) return "ایمیل یا رمز عبور درست نیست.";
  if (status === 403) return "نشست امنیتی منقضی شده است؛ دوباره وارد شو.";
  if (status === 404) return "سرویس حساب در دسترس نیست؛ کمی بعد دوباره تلاش کن.";
  if (status === 409) return "این تغییر قبلاً اعمال شده است؛ وضعیت دوباره بررسی می‌شود.";
  if (status === 413) return "تعداد تغییرات در یک درخواست زیاد است؛ کمتر ارسال کن.";
  if (status === 429) return "چند درخواست پشت هم آمد؛ کمی صبر کن و دوباره تلاش کن.";
  if (status >= 500) return "سرور موقتاً در دسترس نیست؛ بعداً دوباره تلاش کن.";
  return `درخواست ناموفق بود (${status}).`;
}

/* ── Storage (localStorage, best-effort) ────────────────────────────────── */

function storage(): Storage | null {
  try {
    return (globalThis as unknown as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string): T | null {
  try {
    const store = storage();
    if (!store) return null;
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    /* Storage may be blocked or full: the in-memory copy still works. */
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

function hasKey(key: string): boolean {
  try {
    const store = storage();
    return Boolean(store && store.getItem(key) !== null);
  } catch {
    return false;
  }
}

/* ── Normalization ──────────────────────────────────────────────────────── */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function emptyPreferences(): Preferences {
  return { favorites: [], watched: {}, library: {} };
}

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const slug = item.trim();
    if (!slug || slug.length > 300 || seen.has(slug)) continue;
    seen.add(slug);
    result.push(slug);
  }
  return result;
}

export function normalizeWatched(value: unknown): Record<string, number[]> {
  const record = asRecord(value);
  if (!record) return {};
  const result: Record<string, number[]> = {};
  for (const [slug, episodes] of Object.entries(record)) {
    const key = slug.trim();
    if (!key || key.length > 300 || !Array.isArray(episodes)) continue;
    const numbers = [
      ...new Set(
        episodes.filter(
          (episode): episode is number =>
            typeof episode === "number" && Number.isInteger(episode) && episode >= 0,
        ),
      ),
    ].sort((a, b) => a - b);
    if (numbers.length) result[key] = numbers;
  }
  return result;
}

export function parseAccountPreferences(value: unknown): AccountPreferences | null {
  const record = asRecord(value);
  if (!record) return null;
  const shaped =
    "favorites" in record || "watched" in record || "library" in record;
  if (!shaped) return null;
  const revision =
    typeof record.revision === "number" && Number.isFinite(record.revision) ? record.revision : 0;
  return {
    favorites: normalizeStringList(record.favorites),
    watched: normalizeWatched(record.watched),
    library: parseLibrary(record.library),
    revision,
  };
}

export function normalizePreferences(value: unknown): Preferences {
  const parsed = parseAccountPreferences(value);
  if (!parsed) return emptyPreferences();
  return { favorites: parsed.favorites, watched: parsed.watched, library: parsed.library };
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameNumberList(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function samePreferences(a: Preferences, b: Preferences): boolean {
  if (!sameStringList(a.favorites, b.favorites)) return false;
  const aWatched = Object.keys(a.watched);
  const bWatched = Object.keys(b.watched);
  if (aWatched.length !== bWatched.length) return false;
  for (const slug of aWatched) {
    const other = b.watched[slug];
    if (!other || !sameNumberList(a.watched[slug], other)) return false;
  }
  const aLibrary = Object.keys(a.library);
  const bLibrary = Object.keys(b.library);
  if (aLibrary.length !== bLibrary.length) return false;
  return aLibrary.every((slug) => a.library[slug] === b.library[slug]);
}

export function hasPreferenceData(preferences: Preferences): boolean {
  return (
    preferences.favorites.length > 0 ||
    Object.keys(preferences.watched).length > 0 ||
    Object.keys(preferences.library).length > 0
  );
}

/* ── Guest preferences (device-local, non-destructive migration) ────────── */

export function readGuestPreferences(): Preferences | null {
  const favorites = readJson<unknown>(ACCOUNT_STORAGE.guestFavorites);
  const watched = readJson<unknown>(ACCOUNT_STORAGE.guestWatched);
  const library = readJson<unknown>(ACCOUNT_STORAGE.guestLibrary);
  if (favorites === null && watched === null && library === null) return null;
  return {
    favorites: normalizeStringList(favorites),
    watched: normalizeWatched(watched),
    library: parseLibrary(library),
  };
}

export function writeGuestPreferences(preferences: Preferences): void {
  writeJson(ACCOUNT_STORAGE.guestFavorites, preferences.favorites);
  writeJson(ACCOUNT_STORAGE.guestWatched, preferences.watched);
  writeJson(ACCOUNT_STORAGE.guestLibrary, preferences.library);
}

/**
 * Copies the old `av_favorites` / `av_watched` / `av_library` values into the
 * separate `av_guest_*` keys — but only for keys that do not exist yet. The
 * legacy keys themselves are never rewritten or removed, so nothing the user
 * had before is lost.
 */
export function seedGuestPreferences(): Preferences {
  const existing = readGuestPreferences();
  const legacyFavorites = readJson<unknown>(ACCOUNT_STORAGE.legacyFavorites);
  const legacyWatched = readJson<unknown>(ACCOUNT_STORAGE.legacyWatched);
  const legacyLibrary = readJson<unknown>(ACCOUNT_STORAGE.legacyLibrary);

  const seeded: Preferences = {
    favorites: existing ? existing.favorites : normalizeStringList(legacyFavorites),
    watched: existing ? existing.watched : normalizeWatched(legacyWatched),
    library: existing ? existing.library : parseLibrary(legacyLibrary),
  };

  if (!existing) {
    if (legacyFavorites !== null) writeJson(ACCOUNT_STORAGE.guestFavorites, seeded.favorites);
    if (legacyWatched !== null) writeJson(ACCOUNT_STORAGE.guestWatched, seeded.watched);
    if (legacyLibrary !== null) writeJson(ACCOUNT_STORAGE.guestLibrary, seeded.library);
  }
  return seeded;
}

/* ── One-time legacy backup (public data only) ──────────────────────────── */

export function readLegacyBackup(): LegacyBackup | null {
  const raw = readJson<unknown>(ACCOUNT_STORAGE.backup);
  const record = asRecord(raw);
  if (!record) return null;
  const preferences = asRecord(record.preferences);
  if (!preferences) return null;
  const rawUser = asRecord(record.user);
  const user =
    rawUser && typeof rawUser.name === "string" && typeof rawUser.email === "string"
      ? {
          name: rawUser.name,
          email: rawUser.email,
          joinedAt: typeof rawUser.joinedAt === "string" ? rawUser.joinedAt : "",
        }
      : null;
  return {
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    user,
    preferences: normalizePreferences(preferences),
  };
}

/**
 * Creates exactly ONE non-secret snapshot of the pre-upgrade device data:
 * the old public profile (`av_user`) plus favorites/watched/library. Account
 * records (`av_accounts`) and their hashes/passwords are deliberately excluded
 * so no credential material is duplicated into storage.
 */
export function ensureLegacyBackup(): LegacyBackup | null {
  const existing = readLegacyBackup();
  if (existing) return existing;

  const rawUser = asRecord(readJson<unknown>(ACCOUNT_STORAGE.legacyUser));
  const user =
    rawUser && typeof rawUser.name === "string" && typeof rawUser.email === "string"
      ? {
          name: rawUser.name,
          email: rawUser.email,
          joinedAt: typeof rawUser.joinedAt === "string" ? rawUser.joinedAt : "",
        }
      : null;

  const preferences: Preferences = {
    favorites: normalizeStringList(readJson<unknown>(ACCOUNT_STORAGE.legacyFavorites)),
    watched: normalizeWatched(readJson<unknown>(ACCOUNT_STORAGE.legacyWatched)),
    library: parseLibrary(readJson<unknown>(ACCOUNT_STORAGE.legacyLibrary)),
  };

  if (!user && !hasPreferenceData(preferences)) return null;

  const backup: LegacyBackup = {
    createdAt: new Date().toISOString(),
    user,
    preferences,
  };
  writeJson(ACCOUNT_STORAGE.backup, backup);
  return backup;
}

export function legacyBackupImportedAt(): string | null {
  const value = readJson<unknown>(ACCOUNT_STORAGE.backupImportedAt);
  return typeof value === "string" ? value : null;
}

export function markLegacyBackupImported(at = new Date().toISOString()): void {
  writeJson(ACCOUNT_STORAGE.backupImportedAt, at);
}

/* ── Pending operations (per server user, no secrets) ───────────────────── */

export function pendingOperationKey(userId: string): string {
  return `${PENDING_OPERATION_KEY_PREFIX}${userId}`;
}

export function sanitizeOperation(value: unknown): PreferenceOperation | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string" || !/^[a-fA-F0-9-]{32,36}$/.test(record.id)) return null;
  const id = record.id;
  const type = record.type;
  if (type === "clear-favorites") return { id, type: "clear-favorites" };
  if (typeof record.slug !== "string") return null;
  const slug = record.slug.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(slug)) return null;
  if (type === "favorite" && typeof record.value === "boolean") {
    return { id, type: "favorite", slug, value: record.value };
  }
  if (
    type === "watched" &&
    typeof record.value === "boolean" &&
    typeof record.episode === "number" &&
    Number.isInteger(record.episode) &&
    record.episode >= 1 &&
    record.episode <= 9999
  ) {
    return { id, type: "watched", slug, episode: record.episode, value: record.value };
  }
  if (type === "library") {
    const raw = record.value;
    if (raw === null) return { id, type: "library", slug, value: null };
    if (typeof raw === "string" && LIBRARY_STATUSES.includes(raw as LibraryStatus)) {
      return { id, type: "library", slug, value: raw as LibraryStatus };
    }
  }
  return null;
}

export function newOperationId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the local UUID generator */
  }
  const bytes = new Uint8Array(16);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function readPendingOperations(userId: string): PreferenceOperation[] {
  if (!userId) return [];
  const raw = readJson<unknown>(pendingOperationKey(userId));
  if (!Array.isArray(raw)) return [];
  const operations: PreferenceOperation[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const operation = sanitizeOperation(item);
    if (!operation || seen.has(operation.id)) continue;
    seen.add(operation.id);
    operations.push(operation);
  }
  return operations;
}

export function writePendingOperations(userId: string, operations: readonly PreferenceOperation[]): void {
  if (!userId) return;
  const key = pendingOperationKey(userId);
  if (!operations.length) {
    removeKey(key);
    return;
  }
  writeJson(key, operations.slice(-MAX_PENDING_OPERATIONS));
}

/* ── Operation helpers ──────────────────────────────────────────────────── */

export function chunkOperations(
  operations: readonly PreferenceOperation[],
  limit = MAX_OPERATIONS_PER_CALL,
): PreferenceOperation[][] {
  const size = Math.max(1, Math.min(limit, MAX_OPERATIONS_PER_CALL));
  const batches: PreferenceOperation[][] = [];
  for (let index = 0; index < operations.length; index += size) {
    batches.push(operations.slice(index, index + size));
  }
  return batches;
}

/**
 * Applies operations in order on top of the newest server preferences, so a
 * queued change is never lost while the server copy refreshes underneath it.
 */
export function applyOperations(base: Preferences, operations: readonly PreferenceOperation[]): Preferences {
  let favorites = base.favorites;
  let watched = base.watched;
  let library = base.library;

  for (const operation of operations) {
    if (operation.type === "clear-favorites") {
      if (favorites.length) favorites = [];
      continue;
    }
    if (operation.type === "favorite") {
      const present = favorites.includes(operation.slug);
      if (present === operation.value) continue;
      const rest = favorites.filter((slug) => slug !== operation.slug);
      favorites = operation.value ? [operation.slug, ...rest] : rest;
      continue;
    }
    if (operation.type === "watched") {
      const current = watched[operation.slug] ?? [];
      const present = current.includes(operation.episode);
      if (present === operation.value) continue;
      const numbers = operation.value
        ? [...new Set([...current, operation.episode])].sort((a, b) => a - b)
        : current.filter((episode) => episode !== operation.episode);
      const next = { ...watched };
      if (numbers.length) next[operation.slug] = numbers;
      else delete next[operation.slug];
      watched = next;
      continue;
    }
    const nextLibrary = { ...library };
    if (operation.value === null) delete nextLibrary[operation.slug];
    else nextLibrary[operation.slug] = operation.value;
    library = nextLibrary;
  }

  return { favorites, watched, library };
}

/** One-way import: adds local data to the account, never un-selects anything. */
export function importOperations(preferences: Preferences): PreferenceOperation[] {
  const operations: PreferenceOperation[] = [];
  for (const slug of preferences.favorites) {
    operations.push({ id: newOperationId(), type: "favorite", slug, value: true });
  }
  for (const [slug, episodes] of Object.entries(preferences.watched)) {
    for (const episode of episodes) {
      operations.push({ id: newOperationId(), type: "watched", slug, episode, value: true });
    }
  }
  for (const [slug, status] of Object.entries(preferences.library)) {
    operations.push({ id: newOperationId(), type: "library", slug, value: status });
  }
  return operations.filter((operation) => sanitizeOperation(operation) !== null);
}

/* ── HTTP layer ─────────────────────────────────────────────────────────── */

type RequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  csrf?: string;
};

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const external = options.signal;
  const relayAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", relayAbort, { once: true });
  }

  try {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (options.csrf) headers.set("X-CSRF-Token", options.csrf);

    const response = await fetch(`${ACCOUNT_API_BASE}${path}`, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = null;
      }
    }

    if (!response.ok) throw new AccountApiError(errorMessageFor(response.status, payload), response.status);
    return payload as T;
  } catch (error) {
    if (error instanceof AccountApiError) throw error;
    if (timedOut) throw new AccountApiError("پاسخ سرور دیر رسید؛ اتصال را بررسی کن و دوباره تلاش کن.", 0);
    if (isAbortError(error)) throw error;
    throw new AccountApiError("ارتباط با سرور برقرار نشد؛ اینترنت را بررسی کن.", 0);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", relayAbort);
  }
}

/* ── Session API ────────────────────────────────────────────────────────── */

export function parseSession(value: unknown): AccountSession {
  const record = asRecord(value);
  const rawUser = record ? asRecord(record.user) : null;
  if (!rawUser || typeof rawUser.name !== "string" || typeof rawUser.email !== "string") {
    return { user: null, csrf: "", preferences: null };
  }
  if (typeof rawUser.id !== "string" || !/^[a-f0-9]{32}$/.test(rawUser.id) || typeof record?.csrf !== "string" || record.csrf.length < 16) {
    throw new AccountApiError("نشست سرور معتبر نیست؛ دوباره تلاش کن.", 502);
  }
  const role =
    rawUser.role === "user" ||
    rawUser.role === "owner" ||
    rawUser.role === "editor" ||
    rawUser.role === "reviewer"
      ? rawUser.role
      : undefined;
  const email = rawUser.email;
  const user: AccountUser = {
    id: rawUser.id,
    name: rawUser.name,
    email,
    joinedAt: typeof rawUser.joinedAt === "string" ? rawUser.joinedAt : "",
    ...(role ? { role } : {}),
  };
  const csrf = typeof record?.csrf === "string" ? record.csrf : "";
  const preferences = record ? parseAccountPreferences(record.preferences) : null;
  return { user, csrf, preferences };
}

export async function getSession(signal?: AbortSignal): Promise<AccountSession> {
  try {
    const payload = await request<unknown>("/session", {}, { signal, timeoutMs: SESSION_TIMEOUT_MS });
    return parseSession(payload);
  } catch (error) {
    // An absent/expired cookie is a normal signed-out state, not an outage.
    if (error instanceof AccountApiError && (error.status === 401 || error.status === 403)) {
      return { user: null, csrf: "", preferences: null };
    }
    throw error;
  }
}

export async function loginAccount(
  input: { email: string; password: string },
  signal?: AbortSignal,
): Promise<AccountSession> {
  const email = input.email.trim();
  if (!email) throw new AccountApiError("ایمیل را وارد کن.", 400);
  if (email.length > 256) throw new AccountApiError("ایمیل باید حداکثر ۲۵۶ کاراکتر باشد.", 400);
  if (!input.password) throw new AccountApiError("رمز عبور را وارد کن.", 400);
  if (input.password.length > 256) throw new AccountApiError("رمز عبور باید حداکثر ۲۵۶ کاراکتر باشد.", 400);

  const payload = await request<unknown>(
    "/login",
    { method: "POST", body: JSON.stringify({ email, password: input.password }) },
    { signal },
  );
  const session = parseSession(payload);
  if (!session.user) throw new AccountApiError("ورود انجام نشد؛ دوباره تلاش کن.", 401);
  return session;
}

export async function registerAccount(
  input: { name: string; email: string; password: string },
  signal?: AbortSignal,
): Promise<AccountSession> {
  const name = input.name.trim();
  const email = input.email.trim();
  if (name.length < 3) throw new AccountApiError("نام باید حداقل ۳ حرف باشد.", 400);
  if (!email) throw new AccountApiError("ایمیل را وارد کن.", 400);
  if (email.length > 256) throw new AccountApiError("ایمیل باید حداکثر ۲۵۶ کاراکتر باشد.", 400);
  if (input.password.length < 6) {
    throw new AccountApiError("رمز عبور باید حداقل ۶ کاراکتر باشد.", 400);
  }
  if (input.password.length > 256) {
    throw new AccountApiError("رمز عبور باید حداکثر ۲۵۶ کاراکتر باشد.", 400);
  }

  const payload = await request<unknown>(
    "/register",
    { method: "POST", body: JSON.stringify({ name, email, password: input.password }) },
    { signal },
  );
  const session = parseSession(payload);
  if (!session.user) throw new AccountApiError("حساب ساخته نشد؛ دوباره تلاش کن.", 401);
  return session;
}

export async function logoutAccount(csrf: string, signal?: AbortSignal): Promise<void> {
  const payload = await request<unknown>(
    "/session",
    { method: "DELETE", headers: csrf ? { "X-CSRF-Token": csrf } : undefined },
    { signal, csrf },
  );
  const record = asRecord(payload);
  if (record && record.ok === false) {
    throw new AccountApiError(
      typeof record.error === "string" && record.error.trim()
        ? record.error.trim().slice(0, 300)
        : "نشست سرور پاک نشد؛ دوباره تلاش کن.",
      500,
    );
  }
}

export async function saveOperations(
  operations: readonly PreferenceOperation[],
  csrf: string,
  signal?: AbortSignal,
): Promise<AccountPreferences> {
  if (!csrf) throw new AccountApiError("نشست امنیتی منقضی شده است؛ دوباره وارد شو.", 403);
  if (operations.length > MAX_OPERATIONS_PER_CALL) {
    throw new AccountApiError("در هر درخواست حداکثر ۱۰۰ تغییر ارسال می‌شود.", 413);
  }
  if (!operations.length) throw new AccountApiError("هیچ تغییری برای ارسال نیست.", 400);
  const clean: PreferenceOperation[] = [];
  for (const operation of operations) {
    const sanitized = sanitizeOperation(operation);
    if (!sanitized) throw new AccountApiError("تغییر نامعتبر بود؛ دوباره تلاش کن.", 400);
    clean.push(sanitized);
  }

  const payload = await request<unknown>(
    "/preferences",
    { method: "POST", body: JSON.stringify({ operations: clean }) },
    { signal, csrf },
  );
  const direct = parseAccountPreferences(payload);
  if (direct) return direct;
  const nested = asRecord(payload)?.preferences;
  const preferences = parseAccountPreferences(nested);
  if (!preferences) {
    throw new AccountApiError("پاسخ نامعتبر سرور؛ تغییرات روی این دستگاه محفوظ ماند.", 502);
  }
  return preferences;
}
