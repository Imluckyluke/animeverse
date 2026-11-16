import type {
  AdminCatalogPage,
  AdminCommand,
  AdminHistoryPage,
  AdminMutation,
  AdminOverview,
  AdminPostPreview,
  AdminReviewInput,
  AdminReviewPage,
  AdminReviewPreview,
  AdminSession,
  AdminSettings,
  AdminTitleDetail,
  AdminTitlePatch,
  AdminUser,
} from "@/lib/admin-contract";

/** The admin API is same-origin only; the browser sends the HttpOnly cookie. */
export const ADMIN_API_BASE = "/api/admin";
export const LEGACY_ADMIN_KEY_STORAGE = "av_admin_key";

export type AdminSessionResponse = { session: AdminSession | null };
export type AdminMedia = { url: string; previewUrl: string };
export type AdminBackup = { id: string; createdAt: string; size: number; kind: string };
export type AdminUserPage = { items: AdminUser[]; total: number; page: number; pageSize: number };
export type AdminCatalogFilter = "all" | "hidden" | "pinned" | "unpublished";
export type AdminReviewStatus =
  | "all"
  | "missing_title"
  | "missing_episode"
  | "no_reference_match"
  | "ambiguous_remake"
  | "season_conflict"
  | "unsafe_record"
  | "catalog_conflict";

export type AdminCreateUserInput = {
  name: string;
  email: string;
  password: string;
  role: "editor" | "reviewer";
};

export type AdminUserPatch = {
  disabled?: boolean;
  role?: "user" | "editor" | "reviewer";
};

export type AdminEpisodePatch = {
  expectedRevision: number;
  episode: number;
  quality: string;
  hidden: boolean;
  note: string;
};

type RequestOptions = { signal?: AbortSignal };

/** A parsed server error. `status` is kept so 401/409 can be handled precisely. */
export class AdminApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 401;
}

export function isConflict(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 409;
}

export function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: string }).name === "AbortError");
}

export function adminErrorMessage(error: unknown, fallback = "ارتباط با سرور برقرار نشد."): string {
  if (error instanceof AdminApiError) return error.message;
  if (isAbortError(error)) return "";
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${ADMIN_API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
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

  if (!response.ok) {
    const body = asRecord(payload);
    const message =
      typeof body?.error === "string" && body.error.trim()
        ? body.error
        : response.status === 401
          ? "نشست مدیریت معتبر نیست؛ دوباره وارد شوید."
          : response.status === 403
            ? "اجازهٔ انجام این عملیات را ندارید."
            : response.status === 409
              ? "نسخهٔ داده تغییر کرده است؛ دوباره بارگذاری کنید."
              : `درخواست ناموفق بود (${response.status}).`;
    throw new AdminApiError(
      message,
      response.status,
      typeof body?.code === "string" ? body.code : undefined,
    );
  }

  return payload as T;
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

function mutationHeaders(csrf: string): HeadersInit {
  return { "Content-Type": "application/json", "X-CSRF-Token": csrf };
}

function queryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

/* ── Session / login ───────────────────────────────────────────────────── */

export async function getSession(signal?: AbortSignal): Promise<AdminSession | null> {
  try {
    const payload = await request<AdminSessionResponse>("/session", {}, { signal });
    return payload?.session ?? null;
  } catch (error) {
    // An expired/absent cookie is a normal signed-out state, not an outage.
    if (isUnauthorized(error)) return null;
    throw error;
  }
}

export async function login(
  input: { password: string; email?: string },
  signal?: AbortSignal,
): Promise<AdminSession> {
  const payload = await request<AdminSessionResponse>(
    "/session",
    { method: "POST", body: jsonBody(input) },
    { signal },
  );
  if (!payload?.session) {
    throw new AdminApiError("ایمیل یا گذرواژهٔ مدیریت درست نیست.", 401);
  }
  return payload.session;
}

export async function logout(csrf: string, signal?: AbortSignal): Promise<void> {
  await request<unknown>(
    "/session",
    { method: "DELETE", headers: { "X-CSRF-Token": csrf } },
    { signal },
  );
}

/**
 * The old owner key is only read after the user explicitly asks to use it.
 * It lives in sessionStorage for this tab, and the caller removes it only
 * after the server has accepted it.
 */
export function readLegacyAdminKey(): string {
  try {
    return window.sessionStorage.getItem(LEGACY_ADMIN_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function clearLegacyAdminKey(): void {
  try {
    window.sessionStorage.removeItem(LEGACY_ADMIN_KEY_STORAGE);
  } catch {
    /* storage blocked */
  }
}

/* ── Overview / commands ───────────────────────────────────────────────── */

export function getOverview(signal?: AbortSignal): Promise<AdminOverview> {
  return request<AdminOverview>("/overview", {}, { signal });
}

export function getCommand(id: string, signal?: AbortSignal): Promise<AdminCommand> {
  return request<AdminCommand>(`/commands/${encodeURIComponent(id)}`, {}, { signal });
}

export function previewPosts(input: { url: string } | { posts: number }, csrf: string, signal?: AbortSignal): Promise<AdminPostPreview> {
  return request<AdminPostPreview>("/imports/preview", { method: "POST", headers: mutationHeaders(csrf), body: jsonBody(input) }, { signal });
}

export function getPostPreview(id: string, signal?: AbortSignal): Promise<AdminPostPreview> {
  return request<AdminPostPreview>(`/imports/${encodeURIComponent(id)}`, {}, { signal });
}

export function confirmPostImport(id: string, csrf: string): Promise<AdminPostPreview> {
  return request<AdminPostPreview>(`/imports/${encodeURIComponent(id)}/confirm`, {
    method: "POST", headers: mutationHeaders(csrf), body: jsonBody({ confirm: true }),
  });
}

/* ── Catalog ───────────────────────────────────────────────────────────── */

export function getCatalog(
  input: { query?: string; page?: number; filter?: AdminCatalogFilter; targets?: boolean },
  signal?: AbortSignal,
): Promise<AdminCatalogPage> {
  const query = queryString({
    query: input.query?.trim() ?? "",
    page: input.page ?? 1,
    filter: input.filter ?? "all",
    targets: input.targets ? 1 : undefined,
  });
  return request<AdminCatalogPage>(`/catalog${query}`, {}, { signal });
}

export function getTitle(slug: string, signal?: AbortSignal): Promise<AdminTitleDetail> {
  return request<AdminTitleDetail>(`/catalog/${encodeURIComponent(slug)}`, {}, { signal });
}

export function patchTitle(
  slug: string,
  input: { expectedRevision: number; patch: AdminTitlePatch; note: string },
  csrf: string,
  signal?: AbortSignal,
): Promise<AdminMutation> {
  return request<AdminMutation>(
    `/catalog/${encodeURIComponent(slug)}`,
    { method: "PATCH", headers: mutationHeaders(csrf), body: jsonBody(input) },
    { signal },
  );
}

export function patchEpisode(
  slug: string,
  input: AdminEpisodePatch,
  csrf: string,
  signal?: AbortSignal,
): Promise<AdminMutation> {
  return request<AdminMutation>(
    `/catalog/${encodeURIComponent(slug)}/episodes`,
    { method: "PATCH", headers: mutationHeaders(csrf), body: jsonBody(input) },
    { signal },
  );
}

export function uploadMedia(
  input: { data: string; mime: "image/jpeg" | "image/png" | "image/webp" },
  csrf: string,
  signal?: AbortSignal,
): Promise<AdminMedia> {
  return request<AdminMedia>(
    "/media",
    { method: "POST", headers: mutationHeaders(csrf), body: jsonBody(input) },
    { signal },
  );
}

/* ── Archive review ────────────────────────────────────────────────────── */

export function getReview(
  input: { query?: string; page?: number; status?: AdminReviewStatus },
  signal?: AbortSignal,
): Promise<AdminReviewPage> {
  const query = queryString({
    query: input.query?.trim() ?? "",
    page: input.page ?? 1,
    status: input.status ?? "all",
  });
  return request<AdminReviewPage>(`/review${query}`, {}, { signal });
}

export function previewReview(
  input: AdminReviewInput,
  csrf: string,
  signal?: AbortSignal,
): Promise<AdminReviewPreview> {
  return request<AdminReviewPreview>(
    "/review/preview",
    { method: "POST", headers: mutationHeaders(csrf), body: jsonBody(input) },
    { signal },
  );
}

export function applyReview(
  input: { previewId: string; confirm: true },
  csrf: string,
  signal?: AbortSignal,
): Promise<AdminMutation> {
  return request<AdminMutation>(
    "/review/apply",
    { method: "POST", headers: mutationHeaders(csrf), body: jsonBody(input) },
    { signal },
  );
}

/* ── History / users ───────────────────────────────────────────────────── */

export function getHistory(page: number, signal?: AbortSignal): Promise<AdminHistoryPage> {
  return request<AdminHistoryPage>(`/history${queryString({ page })}`, {}, { signal });
}

export function undoEvent(
  id: number,
  input: { confirm: true; note: string },
  csrf: string,
  signal?: AbortSignal,
): Promise<AdminMutation> {
  return request<AdminMutation>(
    `/history/${encodeURIComponent(String(id))}/undo`,
    { method: "POST", headers: mutationHeaders(csrf), body: jsonBody(input) },
    { signal },
  );
}

export function getUsers(
  input: { query?: string; page?: number },
  signal?: AbortSignal,
): Promise<AdminUserPage> {
  const query = queryString({ query: input.query?.trim() ?? "", page: input.page ?? 1 });
  return request<AdminUserPage>(`/users${query}`, {}, { signal });
}

export function patchUser(
  id: string,
  patch: AdminUserPatch,
  csrf: string,
  signal?: AbortSignal,
): Promise<AdminMutation> {
  return request<AdminMutation>(
    `/users/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: mutationHeaders(csrf),
      body: jsonBody({ ...patch, confirm: true }),
    },
    { signal },
  );
}

export function createUser(
  input: AdminCreateUserInput,
  csrf: string,
  signal?: AbortSignal,
): Promise<AdminMutation> {
  return request<AdminMutation>(
    "/users",
    { method: "POST", headers: mutationHeaders(csrf), body: jsonBody(input) },
    { signal },
  );
}

/* ── Settings / publication / backups / password ──────────────────────── */

export function getSettings(signal?: AbortSignal): Promise<AdminSettings> {
  return request<AdminSettings>("/settings", {}, { signal });
}

export function patchSettings(
  input: { expectedRevision: number; publicationMode: "automatic" | "manual" },
  csrf: string,
  signal?: AbortSignal,
): Promise<AdminMutation> {
  return request<AdminMutation>(
    "/settings",
    { method: "PATCH", headers: mutationHeaders(csrf), body: jsonBody(input) },
    { signal },
  );
}

export function publish(csrf: string, signal?: AbortSignal): Promise<AdminMutation> {
  return request<AdminMutation>(
    "/publish",
    { method: "POST", headers: mutationHeaders(csrf), body: jsonBody({ confirm: true }) },
    { signal },
  );
}

export function changePassword(
  input: { oldPassword: string; newPassword: string },
  csrf: string,
  signal?: AbortSignal,
): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    "/password",
    { method: "POST", headers: mutationHeaders(csrf), body: jsonBody(input) },
    { signal },
  );
}

export function getBackups(signal?: AbortSignal): Promise<{ items: AdminBackup[] }> {
  return request<{ items: AdminBackup[] }>("/backups", {}, { signal });
}
