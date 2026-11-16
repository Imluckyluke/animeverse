"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useApp, type User } from "@/lib/app-context";
import { getSession, isAbortError, type AccountSession } from "@/lib/account-client";

const STATUS_TIMEOUT_MS = 12_000;
const MUTATION_TIMEOUT_MS = 20_000;
const PENDING_POLL_MS = 3_500;
const PENDING_RETRY_MS = 6_000;
const PENDING_MAX_MS = 20 * 60 * 1000;
const PENDING_MAX_FAILURES = 3;
const LINK_TTL_MS = 20 * 60 * 1000;
const WORKER_WARNING = "ربات اعلان موقتاً در دسترس نیست؛ روشن یا خاموش کردن اعلان‌های فعلی هنوز کار می‌کند.";

export type TelegramNotifyStatus = {
  linked: boolean; enabled: boolean; favoritesCount: number; botUsername: string;
  pendingCode: boolean; available: boolean; workerHealthy?: boolean;
};
export type TelegramNotifyLink = { url: string; botUsername: string; expiresIn: number };
export type TelegramNotifyValue = {
  ready: boolean; available: boolean; status: TelegramNotifyStatus | null; busy: boolean;
  pending: boolean; error: string | null; warning: string | null;
  connect: () => Promise<void>; setEnabled: (enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>; disconnect: () => Promise<void>;
};

const TelegramNotifyContext = createContext<TelegramNotifyValue | null>(null);

/** Signed-in server accounts only; local device profiles never poll. */
export function notificationAccountId(user: User | null | undefined): string | null {
  if (!user || user.localOnly || typeof user.id !== "string") return null;
  const id = user.id.trim();
  return id.length > 0 && id.length <= 200 ? id : null;
}

export class TelegramNotifyApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "TelegramNotifyApiError";
    this.status = status;
  }
}

function messageForStatus(status: number): string {
  if (status === 401 || status === 403) return "نشست حسابت معتبر نیست؛ دوباره وارد شو.";
  if (status === 404) return "سرویس اعلان تلگرام در دسترس نیست؛ کمی بعد دوباره تلاش کن.";
  if (status === 409) return "وضعیت اعلان تغییر کرده است؛ دوباره بررسی کن.";
  if (status === 429) return "درخواست‌ها زیاد شدند؛ کمی صبر کن و دوباره تلاش کن.";
  if (status === 503) return "سرویس اعلان تلگرام موقتاً در دسترس نیست؛ دوباره تلاش کن.";
  if (status >= 500) return "سرور اعلان تلگرام پاسخ نداد؛ کمی بعد دوباره تلاش کن.";
  return "درخواست اعلان تلگرام انجام نشد؛ دوباره تلاش کن.";
}

function messageForError(error: unknown, fallback: string): string {
  if (error instanceof TelegramNotifyApiError) return error.message;
  if (isAbortError(error)) return "درخواست ناتمام ماند؛ دوباره تلاش کن.";
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizedBot(value: unknown): string {
  if (typeof value !== "string") return "";
  const bot = value.trim().replace(/^@/, "");
  return /^[A-Za-z][A-Za-z0-9_]{2,63}$/.test(bot) ? bot : "";
}

/** Only an explicit server `linked: true` means connected. */
export function parseTelegramNotifyStatus(value: unknown): TelegramNotifyStatus {
  const r = asRecord(value);
  if (!r || typeof r.linked !== "boolean" || typeof r.available !== "boolean") {
    throw new TelegramNotifyApiError("پاسخ وضعیت اعلان معتبر نیست؛ دوباره تلاش کن.", 502);
  }
  return {
    linked: r.linked === true, enabled: r.enabled === true,
    favoritesCount: typeof r.favoritesCount === "number" && Number.isFinite(r.favoritesCount) && r.favoritesCount >= 0 ? Math.floor(r.favoritesCount) : 0,
    botUsername: normalizedBot(r.botUsername), pendingCode: r.pendingCode === true, available: r.available === true,
    ...(typeof r.workerHealthy === "boolean" ? { workerHealthy: r.workerHealthy } : {}),
  };
}

/** Only the exact https://t.me/<verified bot>?start=<code> URL may open. */
export function verifiedTelegramLinkUrl(rawUrl: unknown, rawBotUsername: unknown): string | null {
  if (typeof rawUrl !== "string") return null;
  const bot = normalizedBot(rawBotUsername);
  if (!bot) return null;
  let url: URL;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "t.me") return null;
  if (url.port || url.username || url.password || url.hash) return null;
  if (url.pathname.replace(/\/+$/, "").toLowerCase() !== `/${bot.toLowerCase()}`) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "start") return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(url.searchParams.get("start") ?? "")) return null;
  return url.toString();
}

/* ── Same-origin notification client ───────────────────────────────────── */

type NotificationClientOptions = { signal?: AbortSignal; expectedBotUsername?: string };
export type NotificationClientDeps = {
  fetchImpl?: typeof fetch;
  getSession?: (signal?: AbortSignal) => Promise<AccountSession>;
};
type SendOptions = { method?: string; body?: string; csrf?: string; signal?: AbortSignal };

async function readJson(response: Response): Promise<unknown> {
  try { return (await response.json()) as unknown; } catch { return null; }
}

/** Account-scoped transport: cookie + in-memory CSRF only, no browser identity. */
export function createNotificationClient(accountId: string, deps: NotificationClientDeps = {}) {
  const id = accountId.trim();
  if (!id) throw new TelegramNotifyApiError("حساب کاربری مشخص نیست.", 401);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const readSession = deps.getSession ?? getSession;

  async function send(path: string, options: SendOptions = {}): Promise<unknown> {
    const headers = new Headers({ Accept: "application/json" });
    if (options.csrf) headers.set("X-CSRF-Token", options.csrf);
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    try {
      const response = await fetchImpl(path, {
        method: options.method ?? "GET", credentials: "same-origin", cache: "no-store",
        headers, body: options.body, signal: options.signal,
      });
      const payload = await readJson(response);
      if (!response.ok) throw new TelegramNotifyApiError(messageForStatus(response.status), response.status);
      return payload;
    } catch (error) {
      if (error instanceof TelegramNotifyApiError || isAbortError(error)) throw error;
      throw new TelegramNotifyApiError("ارتباط با سرور اعلان برقرار نشد؛ دوباره تلاش کن.", 0);
    }
  }

  async function csrfFor(signal?: AbortSignal): Promise<string> {
    let session: AccountSession;
    try { session = await readSession(signal); }
    catch (error) {
      if (isAbortError(error)) throw error;
      throw new TelegramNotifyApiError(messageForError(error, "نشست حسابت بررسی نشد؛ دوباره تلاش کن."), 0);
    }
    // Never let account A's session mutate account B after a switch.
    if (!session.user || session.user.id !== id) {
      throw new TelegramNotifyApiError("حساب کاربری عوض شده است؛ صفحه را تازه کن و دوباره تلاش کن.", 403);
    }
    const csrf = session.csrf.trim();
    if (!csrf) throw new TelegramNotifyApiError("نشست امنیتی معتبر نیست؛ دوباره وارد شو.", 403);
    return csrf;
  }

  const status = async (signal?: AbortSignal) =>
    parseTelegramNotifyStatus(await send("/api/notifications/status", { signal }));

  async function link(options: NotificationClientOptions = {}): Promise<TelegramNotifyLink> {
    const csrf = await csrfFor(options.signal);
    const payload = asRecord(await send("/api/notifications/link", {
      method: "POST", csrf, body: "{}", signal: options.signal,
    }));
    const botUsername = normalizedBot(payload?.botUsername);
    const expected = normalizedBot(options.expectedBotUsername);
    if (!botUsername || (expected && expected.toLowerCase() !== botUsername.toLowerCase())) {
      throw new TelegramNotifyApiError("ربات تلگرام تأیید نشد؛ دوباره تلاش کن.", 502);
    }
    const url = verifiedTelegramLinkUrl(payload?.url, botUsername);
    if (!url) throw new TelegramNotifyApiError("لینک ربات تلگرام معتبر نبود؛ دوباره تلاش کن.", 502);
    return { url, botUsername, expiresIn: 1200 };
  }

  const setEnabled = async (enabled: boolean, signal?: AbortSignal) =>
    parseTelegramNotifyStatus(await send("/api/notifications/preferences", {
      method: "POST", csrf: await csrfFor(signal), body: JSON.stringify({ enabled }), signal,
    }));

  const unlink = async (signal?: AbortSignal) => {
    await send("/api/notifications/unlink", { method: "DELETE", csrf: await csrfFor(signal), signal });
  };

  return { status, link, setEnabled, unlink };
}

/* ── Provider ───────────────────────────────────────────────────────────── */

export function TelegramNotifyProvider({ children }: { children: ReactNode }) {
  const { ready: appReady, user, favorites, pendingSyncCount, toast } = useApp();
  const accountId = notificationAccountId(user);
  const favoritesKey = favorites.join("|");
  const [status, setStatus] = useState<TelegramNotifyStatus | null>(null);
  const [loading, setLoading] = useState(true), [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  const statusOwnerRef = useRef<string | null>(accountId);
  const visibleStatus = statusOwnerRef.current === accountId ? status : null;
  const statusRef = useRef(visibleStatus);
  statusRef.current = visibleStatus;
  const availableRef = useRef(available);
  availableRef.current = available;
  const busyRef = useRef(false);
  const readSequenceRef = useRef(0);
  const readAbortRef = useRef<AbortController | null>(null);
  const mutationAbortRef = useRef<AbortController | null>(null);
  const mutationTimerRef = useRef<number | null>(null);
  const mutationTimedOutRef = useRef(false);
  const pendingDeadlineRef = useRef(0); // 0 idle, positive deadline, -1 expired
  const lastFavoritesRef = useRef(favoritesKey);
  const lastFavoritesAccountRef = useRef(accountId);

  const publishStatus = useCallback((next: TelegramNotifyStatus | null) => {
    statusOwnerRef.current = accountRef.current;
    setStatus(next);
  }, []);

  const abortAll = useCallback(() => {
    readSequenceRef.current += 1;
    readAbortRef.current?.abort();
    readAbortRef.current = null;
    mutationAbortRef.current?.abort();
    mutationAbortRef.current = null;
    if (mutationTimerRef.current !== null) window.clearTimeout(mutationTimerRef.current);
    mutationTimerRef.current = null;
  }, []);

  const runStatus = useCallback(async (): Promise<TelegramNotifyStatus | null> => {
    const id = accountRef.current;
    if (!id) return null;
    const sequence = ++readSequenceRef.current;
    readAbortRef.current?.abort();
    const controller = new AbortController();
    readAbortRef.current = controller;
    const current = () => accountRef.current === id && readSequenceRef.current === sequence;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, STATUS_TIMEOUT_MS);
    try {
      const next = await createNotificationClient(id).status(controller.signal);
      if (!current()) return null;
      publishStatus(next);
      setAvailable(next.available);
      setError(next.available ? null : "سرویس اعلان تلگرام روی این نسخه فعال نیست؛ دوباره بررسی کن.");
      const deadline = pendingDeadlineRef.current;
      if (next.linked) {
        pendingDeadlineRef.current = 0;
        setPending(false);
      } else if (next.pendingCode && deadline === 0) {
        pendingDeadlineRef.current = Date.now() + PENDING_MAX_MS;
        setPending(true);
      } else if (deadline > Date.now()) setPending(true);
      else if (deadline !== 0) {
        pendingDeadlineRef.current = -1;
        setPending(false);
        setError("کد اتصال تلگرام منقضی شد؛ دوباره تلاش کن.");
      } else setPending(false);
      return next;
    } catch (caught) {
      if (!current()) return null;
      if (isAbortError(caught) && !timedOut) return null;
      if (caught instanceof TelegramNotifyApiError && caught.status === 401) {
        publishStatus(null);
        pendingDeadlineRef.current = 0;
        setPending(false);
        setError("نشست حسابت منقضی شده است؛ دوباره وارد شو.");
        return null;
      }
      if (caught instanceof TelegramNotifyApiError && caught.status === 503) setAvailable(false);
      setError(timedOut ? "پاسخ سرور اعلان دیر رسید؛ دوباره تلاش کن."
        : messageForError(caught, "وضعیت اعلان تلگرام در دسترس نیست؛ دوباره تلاش کن."));
      return null;
    } finally {
      window.clearTimeout(timer);
      if (readAbortRef.current === controller) readAbortRef.current = null;
      if (current()) setLoading(false);
    }
  }, [publishStatus]);

  const refresh = useCallback(async () => { await runStatus(); }, [runStatus]);

  // Account switches/logout reset and abort all previous-account work. Focus
  // and visibility listeners are attached only for an active account.
  useEffect(() => {
    abortAll();
    pendingDeadlineRef.current = 0;
    busyRef.current = false;
    setBusy(false); setPending(false); setError(null); setAvailable(true);
    publishStatus(null);
    if (!appReady) { setLoading(true); return abortAll; }
    if (!accountId) { setLoading(false); return abortAll; }
    setLoading(true);
    void runStatus();
    const refreshOnFocus = () => void runStatus();
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void runStatus(); };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      abortAll();
    };
  }, [abortAll, appReady, accountId, publishStatus, runStatus]);

  // Bounded, non-overlapping polling: schedule only after a read finishes.
  useEffect(() => {
    if (!appReady || !accountId || !pending) return;
    let cancelled = false, failures = 0, timer: number | null = null;
    const schedule = (delay: number) => {
      if (!cancelled) timer = window.setTimeout(() => void tick(), delay);
    };
    const tick = async () => {
      timer = null;
      if (cancelled) return;
      if (Date.now() > pendingDeadlineRef.current) {
        pendingDeadlineRef.current = -1;
        setPending(false);
        setError("کد اتصال تلگرام منقضی شد؛ دوباره تلاش کن.");
        return;
      }
      const expected = readSequenceRef.current + 1;
      const ok = Boolean(await runStatus());
      if (cancelled) return;
      if (readSequenceRef.current !== expected) return schedule(PENDING_POLL_MS);
      failures = ok ? 0 : failures + 1;
      if (failures >= PENDING_MAX_FAILURES || pendingDeadlineRef.current <= 0) {
        pendingDeadlineRef.current = -1;
        setPending(false);
        return;
      }
      schedule(ok ? PENDING_POLL_MS : PENDING_RETRY_MS);
    };
    schedule(2_500);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [appReady, accountId, pending, runStatus]);

  // Server favourites stay authoritative; only the displayed count is refreshed.
  useEffect(() => {
    if (lastFavoritesAccountRef.current !== accountId) {
      lastFavoritesAccountRef.current = accountId;
      lastFavoritesRef.current = favoritesKey;
      return;
    }
    if (!appReady || !accountId || pendingSyncCount !== 0 || favoritesKey === lastFavoritesRef.current) return;
    lastFavoritesRef.current = favoritesKey;
    const timer = window.setTimeout(() => {
      if (accountRef.current === accountId) void runStatus();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [appReady, accountId, favoritesKey, pendingSyncCount, runStatus]);

  const runMutation = useCallback(async <T,>(
    action: (client: ReturnType<typeof createNotificationClient>, signal: AbortSignal) => Promise<T>,
    title: string, fallback: string, onError?: () => void,
  ): Promise<T | null> => {
    const id = accountRef.current;
    if (!id || busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    mutationAbortRef.current?.abort();
    if (mutationTimerRef.current !== null) window.clearTimeout(mutationTimerRef.current);
    const controller = new AbortController();
    mutationAbortRef.current = controller;
    mutationTimedOutRef.current = false;
    mutationTimerRef.current = window.setTimeout(() => {
      mutationTimerRef.current = null;
      mutationTimedOutRef.current = true;
      controller.abort();
    }, MUTATION_TIMEOUT_MS);
    try {
      const result = await action(createNotificationClient(id), controller.signal);
      return accountRef.current === id ? result : null;
    } catch (caught) {
      if (accountRef.current !== id) return null;
      const timedOut = mutationTimedOutRef.current;
      if (isAbortError(caught) && !timedOut) return null;
      const message = timedOut ? "پاسخ سرور دیر رسید؛ دوباره تلاش کن." : messageForError(caught, fallback);
      setError(message);
      toast(title, message, "error");
      onError?.();
      return null;
    } finally {
      if (mutationAbortRef.current === controller) {
        mutationAbortRef.current = null;
        if (mutationTimerRef.current !== null) window.clearTimeout(mutationTimerRef.current);
        mutationTimerRef.current = null;
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [toast]);

  const connect = useCallback(async () => {
    const id = accountRef.current;
    if (!id) return;
    if (!availableRef.current) {
      toast("اعلان تلگرام در دسترس نیست", "این قابلیت روی این نسخه از سایت فعال نیست.", "info");
      return;
    }
    if (statusRef.current?.workerHealthy === false) {
      toast("ربات اعلان موقتاً در دسترس نیست", "تنظیم اعلان‌های فعلی هنوز در دسترس است؛ کمی بعد دوباره تلاش کن.", "info");
      return;
    }
    const popup = { current: null as Window | null };
    // runMutation calls this action synchronously, keeping the tab inside the
    // original user gesture (required by iOS/Chrome).
    const result = await runMutation((client, signal) => {
      popup.current = window.open("about:blank", "_blank");
      if (popup.current) {
        try { popup.current.opener = null; } catch { /* The browser may already have severed it. */ }
      }
      return client.link({ signal, expectedBotUsername: statusRef.current?.botUsername });
    }, "اتصال انجام نشد", "اتصال تلگرام انجام نشد؛ دوباره تلاش کن.", () => popup.current?.close());
    if (!result || accountRef.current !== id) { popup.current?.close(); return; }
    // The client validated the bot and URL before returning it.
    if (popup.current && !popup.current.closed) popup.current.location.href = result.url;
    else window.location.href = result.url;
    pendingDeadlineRef.current = Date.now() + LINK_TTL_MS;
    setPending(true);
    setError(null);
    toast("ربات تلگرام باز شد", "در ربات روی Start بزن؛ اتصال خودکار انجام می‌شود.");
  }, [runMutation, toast]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (!statusRef.current?.linked) { await connect(); return; }
    const next = await runMutation(
      (client, signal) => client.setEnabled(enabled, signal),
      "تنظیم اعلان انجام نشد", "تنظیم اعلان انجام نشد؛ دوباره تلاش کن.",
    );
    if (!next) return;
    if (!next.linked) {
      setError("اتصال تلگرام برقرار نیست؛ دوباره وصلش کن.");
      toast("تنظیم اعلان انجام نشد", "اتصال تلگرام را دوباره بررسی کن.", "error");
      return;
    }
    publishStatus(next);
    setAvailable(next.available);
    if (next.enabled !== enabled) {
      setError("وضعیت اعلان روی سرور تغییر نکرد؛ دوباره بررسی کن.");
      toast("تنظیم اعلان انجام نشد", "وضعیت روی سرور تغییر نکرد؛ دوباره تلاش کن.", "error");
      return;
    }
    setError(null);
    toast(enabled ? "اعلان قسمت جدید روشن شد" : "اعلان قسمت جدید خاموش شد",
      enabled ? "قسمت تازهٔ انیمه‌های لایک‌شده در تلگرام برایت می‌آید." : "می‌تونی هر وقت خواستی دوباره روشنش کنی.",
      enabled ? "success" : "info");
  }, [connect, publishStatus, runMutation, toast]);

  const disconnect = useCallback(async () => {
    const result = await runMutation(async (client, signal) => {
      await client.unlink(signal);
      return true;
    }, "قطع اتصال انجام نشد", "قطع اتصال انجام نشد؛ دوباره تلاش کن.");
    if (!result) return;
    pendingDeadlineRef.current = 0;
    setPending(false); publishStatus(null); setAvailable(true); setError(null); setLoading(true);
    void runStatus();
    toast("اتصال تلگرام قطع شد", "هر وقت خواستی دوباره وصلش کن.", "info");
  }, [publishStatus, runMutation, runStatus, toast]);

  return (
    <TelegramNotifyContext.Provider value={{
      ready: !loading, available, status: visibleStatus, busy, pending, error,
      warning: visibleStatus?.available && visibleStatus.workerHealthy === false ? WORKER_WARNING : null,
      connect, setEnabled, refresh, disconnect,
    }}>
      {children}
    </TelegramNotifyContext.Provider>
  );
}

export function useTelegramNotify(): TelegramNotifyValue {
  const context = useContext(TelegramNotifyContext);
  if (!context) throw new Error("useTelegramNotify must be used inside <TelegramNotifyProvider>");
  return context;
}
