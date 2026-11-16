"use client";

import { MotionConfig } from "framer-motion";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AppContext,
  type AuthResult,
  type ToastItem,
  type User,
} from "@/lib/app-context";
import { PwaProvider } from "@/components/pwa-provider";
import { TelegramNotifyProvider } from "@/components/telegram-notify-provider";
import { ToastViewport } from "@/components/toast";
import { DownloadsProvider } from "@/components/downloads/downloads-provider";
import { DownloadCenter } from "@/components/downloads/download-center";
import { LIBRARY_LABELS, type LibraryState, type LibraryStatus } from "@/lib/library";
import { clearLegacySession, legacyPreferences, readLegacySession, saveLegacyPreferences, verifyLegacyAccount } from "@/lib/legacy-account";
import {
  MAX_IMPORT_OPERATIONS,
  MAX_OPERATIONS_PER_CALL,
  SESSION_TIMEOUT_MS,
  accountErrorMessage,
  applyOperations,
  chunkOperations,
  ensureLegacyBackup,
  getSession,
  hasPreferenceData,
  importOperations,
  isAbortError,
  legacyBackupImportedAt,
  loginAccount,
  logoutAccount,
  markLegacyBackupImported,
  newOperationId,
  readGuestPreferences,
  readLegacyBackup,
  readPendingOperations,
  registerAccount,
  samePreferences,
  saveOperations,
  seedGuestPreferences,
  writeGuestPreferences,
  writePendingOperations,
  type AccountSession,
  type PreferenceOperation,
  type Preferences,
} from "@/lib/account-client";

/** Local changes coalesce briefly before they travel to the server. */
const FLUSH_DEBOUNCE_MS = 600;
const MAX_FLUSH_RETRIES = 5;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
const OFFLINE_MESSAGE = "اتصال اینترنت را بررسی کن.";
const STALLED_MESSAGE = "ذخیرهٔ تغییرات انجام نشد؛ دوباره تلاش کن.";

export function Providers({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [watched, setWatched] = useState<Record<string, number[]>>({});
  const [library, setLibrary] = useState<LibraryState>({});
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [canImportLocalPreferences, setCanImportLocalPreferences] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(1);
  const toastTimer = useRef<number | null>(null);

  // Sync bookkeeping lives in refs so callbacks stay stable and no stale
  // closure can ever carry one account's data into another one.
  const visibleRef = useRef<Preferences>({ favorites: [], watched: {}, library: {} });
  const userIdRef = useRef<string | null>(null);
  const userEmailRef = useRef<string | null>(null);
  const csrfRef = useRef("");
  const queueRef = useRef<PreferenceOperation[]>([]);
  const syncErrorRef = useRef<string | null>(null);
  const retryRef = useRef(0);
  const preferencesSeqRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);
  const flushSlotRef = useRef<object | null>(null);
  const flushAbortRef = useRef<AbortController | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const importAbortRef = useRef<AbortController | null>(null);
  const signedInRef = useRef(user);
  signedInRef.current = user;

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (title: string, description?: string, tone: ToastItem["tone"] = "success") => {
      const id = toastSeq.current++;
      // One at a time: a new message replaces whatever is on screen.
      setToasts([{ id, title, description, tone }]);
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => dismissToast(id), 4200);
    },
    [dismissToast],
  );

  const updateSyncError = useCallback((message: string | null) => {
    syncErrorRef.current = message;
    setSyncError(message);
  }, []);

  const setQueue = useCallback((operations: PreferenceOperation[]) => {
    queueRef.current = operations;
    setPendingSyncCount(operations.length);
  }, []);

  const persistQueue = useCallback(() => {
    const userId = userIdRef.current;
    if (userId) writePendingOperations(userId, queueRef.current);
  }, []);

  /** Single writer for the visible preferences (optimistic + server overlay). */
  const updateVisible = useCallback((mutate: (current: Preferences) => Preferences) => {
    const next = mutate(visibleRef.current);
    if (samePreferences(visibleRef.current, next)) return;
    visibleRef.current = next;
    setFavorites(next.favorites);
    setWatched(next.watched);
    setLibrary(next.library);
  }, []);

  const refreshImportEligibility = useCallback(() => {
    const backup = readLegacyBackup();
    const signedInEmail = (userEmailRef.current ?? "").trim().toLowerCase();
    const backupEmail = (backup?.user?.email ?? "").trim().toLowerCase();
    const eligible = Boolean(
      signedInEmail &&
        backupEmail &&
        signedInEmail === backupEmail &&
        backup &&
        hasPreferenceData(backup.preferences) &&
        legacyBackupImportedAt() === null,
    );
    setCanImportLocalPreferences(eligible);
  }, []);

  /** Drops everything in flight for the current identity (never its queue). */
  const invalidateInFlight = useCallback(() => {
    preferencesSeqRef.current += 1;
    retryRef.current = 0;
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    flushSlotRef.current = null;
    flushAbortRef.current?.abort();
    flushAbortRef.current = null;
    importAbortRef.current?.abort();
    importAbortRef.current = null;
    setSyncing(false);
  }, []);

  const scheduleFlush = useCallback((delay = FLUSH_DEBOUNCE_MS) => {
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      void flushRef.current();
    }, delay);
  }, []);

  const runFlush = useCallback(async () => {
    if (flushSlotRef.current) return;
    const userId = userIdRef.current;
    const csrf = csrfRef.current;
    if (!userId || !csrf) return;

    const batch = queueRef.current.slice(0, MAX_OPERATIONS_PER_CALL);
    if (!batch.length) {
      retryRef.current = 0;
      updateSyncError(null);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      updateSyncError(OFFLINE_MESSAGE);
      return;
    }

    const slot = {};
    flushSlotRef.current = slot;
    const controller = new AbortController();
    flushAbortRef.current = controller;
    setSyncing(true);
    const sequence = ++preferencesSeqRef.current;

    try {
      const preferences = await saveOperations(batch, csrf, controller.signal);
      if (sequence !== preferencesSeqRef.current || userIdRef.current !== userId) return;

      // Server dedups by operation id, so acknowledging the sent batch is safe.
      const acknowledged = new Set(batch.map((operation) => operation.id));
      const remaining = queueRef.current.filter((operation) => !acknowledged.has(operation.id));
      setQueue(remaining);
      persistQueue();

      const hadError = syncErrorRef.current !== null;
      retryRef.current = 0;
      updateSyncError(null);

      if (remaining.length) {
        updateVisible(() => applyOperations(preferences, remaining));
        scheduleFlush();
        return;
      }
      updateVisible(() => preferences);
      if (hadError) toast("تغییرات ذخیره شد");
    } catch (error) {
      if (sequence !== preferencesSeqRef.current || userIdRef.current !== userId) return;
      if (isAbortError(error)) return;
      retryRef.current += 1;
      const message = "ذخیرهٔ تغییرات انجام نشد؛ دوباره تلاش کن.";
      const firstFailure = syncErrorRef.current === null;
      updateSyncError(
        retryRef.current <= MAX_FLUSH_RETRIES ? message : STALLED_MESSAGE,
      );
      if (firstFailure) toast("همگام‌سازی ابری ناموفق", message, "error");
      if (retryRef.current <= MAX_FLUSH_RETRIES) {
        const index = Math.min(retryRef.current - 1, RETRY_DELAYS_MS.length - 1);
        scheduleFlush(RETRY_DELAYS_MS[index]);
      }
    } finally {
      if (flushSlotRef.current === slot) {
        flushSlotRef.current = null;
        setSyncing(false);
      }
      if (flushAbortRef.current === controller) flushAbortRef.current = null;
    }
  }, [persistQueue, scheduleFlush, setQueue, toast, updateSyncError, updateVisible]);

  useEffect(() => {
    flushRef.current = runFlush;
  }, [runFlush]);

  const adoptSession = useCallback(
    (session: AccountSession) => {
      invalidateInFlight();

      const nextUser = session.user;
      if (!nextUser) {
        // A signed-out response is a real guest state: a cached profile is
        // never treated as an identity, and the local guest data stays put.
        userIdRef.current = null;
        userEmailRef.current = null;
        csrfRef.current = "";
        setQueue([]);
        updateSyncError(null);
        setUser(null);
        refreshImportEligibility();
        return;
      }

      csrfRef.current = session.csrf;
      clearLegacySession();
      userIdRef.current = nextUser.id;
      userEmailRef.current = nextUser.email;

      // Queue is stored per server user.id, so nothing can leak across accounts.
      const queue = readPendingOperations(nextUser.id);
      setQueue(queue);

      const base = session.preferences ?? { favorites: [], watched: {}, library: {}, revision: 0 };
      updateVisible(() => applyOperations(base, queue));
      updateSyncError(null);
      setUser({
        id: nextUser.id,
        name: nextUser.name,
        email: nextUser.email,
        joinedAt: nextUser.joinedAt,
        role: nextUser.role,
      });
      refreshImportEligibility();
      if (queue.length) scheduleFlush();
    },
    [invalidateInFlight, refreshImportEligibility, scheduleFlush, setQueue, updateSyncError, updateVisible],
  );

  const adoptLegacy = useCallback((localUser: User) => {
    invalidateInFlight();
    userIdRef.current = null; userEmailRef.current = null; csrfRef.current = "";
    setQueue([]); updateSyncError(null); setCanImportLocalPreferences(false);
    updateVisible(() => legacyPreferences(localUser.email));
    setUser(localUser);
  }, [invalidateInFlight, setQueue, updateSyncError, updateVisible]);

  useEffect(() => {
    const retry = () => {
      if (!userIdRef.current || !queueRef.current.length) return;
      retryRef.current = 0;
      if (syncErrorRef.current) updateSyncError(null);
      scheduleFlush(250);
    };
    const handleOnline = () => retry();
    const handleOffline = () => {
      if (userIdRef.current && queueRef.current.length) updateSyncError(OFFLINE_MESSAGE);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      importAbortRef.current?.abort();
      flushAbortRef.current?.abort();
    };
  }, [scheduleFlush, updateSyncError]);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  // Boot: preserve history first, then probe the session with a hard timeout.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SESSION_TIMEOUT_MS);

    // One non-secret backup of the pre-upgrade device data, before anything
    // else runs (account hashes/passwords are deliberately not copied).
    ensureLegacyBackup();
    refreshImportEligibility();
    // Guest preferences live in their own keys; the legacy keys stay untouched.
    updateVisible(() => seedGuestPreferences());

    void (async () => {
      try {
        const session = await getSession(controller.signal);
        if (cancelled) return;
        const localUser = !session.user ? readLegacySession() : null;
        if (localUser) adoptLegacy(localUser); else adoptSession(session);
      } catch (error) {
        if (cancelled) return;
        if (isAbortError(error) && !timedOut) return;
        toast(
          timedOut ? "پاسخ سرور دیر رسید" : "اتصال به سرور برقرار نشد",
          "اتصال را بررسی کن و دوباره تلاش کن.",
          "info",
        );
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [adoptSession, adoptLegacy, refreshImportEligibility, toast, updateVisible]);

  // Guest mode only: signed-in preferences live on the server, and writing
  // them here would leak one account's data into another person's local list.
  useEffect(() => {
    if (ready && user?.localOnly) { saveLegacyPreferences(user.email, { favorites, watched, library }); return; }
    if (!ready || user) return;
    writeGuestPreferences({ favorites, watched, library });
  }, [ready, user, favorites, watched, library]);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      try {
        const session = await loginAccount({ email, password });
        adoptSession(session);
        const displayName = session.user?.name ?? "";
        toast(
          `خوش برگشتی، ${displayName.split(" ")[0] || displayName}!`,
          "به حساب خودت وارد شدی.",
        );
        return { ok: true };
      } catch (error) {
        try {
          const localUser = await verifyLegacyAccount(email, password);
          if (localUser) {
            adoptLegacy(localUser);
            toast("خوش برگشتی");
            return { ok: true };
          }
        } catch { /* A corrupt local record never grants a server session. */ }
        return {
          ok: false,
          error: accountErrorMessage(error, "ورود انجام نشد؛ اتصال را بررسی کن و دوباره تلاش کن."),
        };
      }
    },
    [adoptSession, adoptLegacy, toast],
  );

  const register = useCallback(
    async (name: string, email: string, password: string): Promise<AuthResult> => {
      try {
        const session = await registerAccount({ name, email, password });
        adoptSession(session);
        toast("حسابت ساخته شد", "به انیمه‌ورس خوش آمدی.");
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: accountErrorMessage(error, "ساخت حساب انجام نشد؛ دوباره تلاش کن."),
        };
      }
    },
    [adoptSession, toast],
  );

  const logout = useCallback(() => {
    const csrf = csrfRef.current;
    const wasSignedIn = userIdRef.current !== null;

    // Local sign-out happens right away; the queued operations of this user
    // stay under their own id and never follow the next account.
    invalidateInFlight();
    if (user?.localOnly) {
      saveLegacyPreferences(user.email, visibleRef.current); clearLegacySession();
      userIdRef.current = null; userEmailRef.current = null; csrfRef.current = "";
      setQueue([]); setUser(null); updateVisible(() => seedGuestPreferences());
      updateSyncError(null); setCanImportLocalPreferences(false);
      return;
    }
    userIdRef.current = null;
    userEmailRef.current = null;
    csrfRef.current = "";
    setQueue([]);
    updateSyncError(null);
    setUser(null);
    updateVisible(() => readGuestPreferences() ?? seedGuestPreferences());
    refreshImportEligibility();

    // The cookie is HttpOnly: only the server can clear it, so always ask —
    // and report the outcome honestly instead of pretending it worked.
    void (async () => {
      let failure: string | null = null;
      try {
        await logoutAccount(csrf);
      } catch (error) {
        if (!isAbortError(error)) {
          failure = accountErrorMessage(error, "نشست سرور پاک نشد.");
        }
      }
      if (failure && wasSignedIn) {
        toast("خروج از حساب کامل نشد", "دوباره تلاش کن.", "error");
      } else {
        toast("از حساب خارج شدی", "هر وقت خواستی برگرد؛ آرشیو منتظرت است.", "info");
      }
    })();
  }, [user, invalidateInFlight, refreshImportEligibility, setQueue, toast, updateSyncError, updateVisible]);

  const importLocalPreferences = useCallback(async (): Promise<AuthResult> => {
    const userId = userIdRef.current;
    const csrf = csrfRef.current;
    if (!userId || !csrf) {
      return { ok: false, error: "ابتدا وارد حساب شو." };
    }

    const backup = readLegacyBackup();
    if (!backup) {
      return { ok: false, error: "نسخهٔ پشتیبان محلی پیدا نشد؛ داده‌ای برای انتقال نیست." };
    }
    const backupEmail = (backup.user?.email ?? "").trim().toLowerCase();
    const accountEmail = (userEmailRef.current ?? "").trim().toLowerCase();
    if (!backupEmail || !accountEmail || backupEmail !== accountEmail) {
      return {
        ok: false,
        error:
          "ایمیل نسخهٔ پشتیبان محلی با این حساب یکی نیست؛ برای جلوگیری از قاطی شدن داده‌ها انتقال انجام نشد.",
      };
    }
    if (!hasPreferenceData(backup.preferences)) {
      return { ok: false, error: "در نسخهٔ پشتیبان محلی داده‌ای برای انتقال نیست." };
    }

    const operations = importOperations(backup.preferences);
    if (!operations.length) {
      return { ok: false, error: "در نسخهٔ پشتیبان محلی داده‌ای برای انتقال نیست." };
    }
    if (operations.length > MAX_IMPORT_OPERATIONS) {
      return {
        ok: false,
        error: `تعداد موارد (${operations.length}) بیش از حد بزرگ است؛ برای حفظ داده‌ها انتقال انجام نشد.`,
      };
    }

    const controller = new AbortController();
    importAbortRef.current = controller;
    const batches = chunkOperations(operations);
    let sent = 0;

    try {
      for (const batch of batches) {
        if (userIdRef.current !== userId || controller.signal.aborted) break;
        const applied = await saveOperations(batch, csrf, controller.signal);
        sent += batch.length;
        // Refresh the visible list with the newest server copy, keeping every
        // operation that is still queued (including ones made mid-import).
        updateVisible(() => applyOperations(applied, queueRef.current));
      }
    } catch (error) {
      const summary = `${sent} از ${operations.length} مورد ارسال شد`;
      if (isAbortError(error) || userIdRef.current !== userId) {
        return {
          ok: false,
          error: `انتقال متوقف شد (${summary})؛ داده‌های محلی دست‌نخورده ماندند.`,
        };
      }
      return {
        ok: false,
        error: `${accountErrorMessage(error, "انتقال ناتمام ماند.")} (${summary}) و داده‌های محلی دست‌نخورده ماندند.`,
      };
    } finally {
      if (importAbortRef.current === controller) importAbortRef.current = null;
    }

    if (sent !== operations.length || userIdRef.current !== userId) {
      return {
        ok: false,
        error: `انتقال ناتمام ماند (${sent} از ${operations.length} مورد)؛ داده‌های محلی دست‌نخورده ماندند.`,
      };
    }

    markLegacyBackupImported();
    setCanImportLocalPreferences(false);
    toast(
      "انتقال انجام شد",
        "فهرست قبلی به کتابخانه اضافه شد.",
    );
    return { ok: true };
  }, [toast, updateVisible]);

  const enqueueOperation = useCallback(
    (operation: PreferenceOperation) => {
      if (!userIdRef.current) return; // guest: local storage only
      setQueue([...queueRef.current, operation]);
      persistQueue();
      scheduleFlush();
    },
    [persistQueue, scheduleFlush, setQueue],
  );

  const toggleFavorite = useCallback(
    (slug: string) => {
      if (!signedInRef.current) { toast("ابتدا وارد حساب شو", "کتابخانهٔ شخصی فقط پس از ورود در دسترس است.", "info"); return; }
      const exists = visibleRef.current.favorites.includes(slug);
      updateVisible((current) => {
        const rest = current.favorites.filter((value) => value !== slug);
        return { ...current, favorites: exists ? rest : [slug, ...rest] };
      });
      enqueueOperation({ id: newOperationId(), type: "favorite", slug, value: !exists });
      // Toast outside the updater: an updater must stay pure, or a replayed
      // render fires the message twice (and the toast visibly blinks).
      if (exists) {
        toast("از علاقه‌مندی‌ها حذف شد", "می‌توانی بعداً دوباره اضافه‌اش کنی.", "info");
      } else {
        toast("به علاقه‌مندی‌ها اضافه شد", "لیست شخصی‌ات ذخیره شد.");
      }
    },
    [enqueueOperation, toast, updateVisible],
  );

  const isFavorite = useCallback((slug: string) => Boolean(user && favorites.includes(slug)), [user, favorites]);

  const setLibraryStatus = useCallback(
    (slug: string, status: LibraryStatus | null) => {
      if (!signedInRef.current) { toast("ابتدا وارد حساب شو", "برای ذخیره در کتابخانه وارد شو.", "info"); return; }
      if (!slug) return;
      updateVisible((current) => {
        const next = { ...current.library };
        if (status === null) delete next[slug];
        else next[slug] = status;
        return { ...current, library: next };
      });
      enqueueOperation({ id: newOperationId(), type: "library", slug, value: status });
      toast(
        status ? `به «${LIBRARY_LABELS[status]}» منتقل شد` : "از دسته‌بندی برداشته شد",
        "پیشرفت قسمت‌ها و علاقه‌مندی‌ها حفظ می‌مانند.",
        "info",
      );
    },
    [enqueueOperation, toast, updateVisible],
  );

  const clearFavorites = useCallback(() => {
    if (!signedInRef.current) return;
    updateVisible((current) => ({ ...current, favorites: [] }));
    enqueueOperation({ id: newOperationId(), type: "clear-favorites" });
    toast("لیست علاقه‌مندی‌ها خالی شد", "یک شروع تازه برای کشف انیمه‌های بعدی.", "info");
  }, [enqueueOperation, toast, updateVisible]);

  const markWatched = useCallback(
    (slug: string, episode: number) => {
      if (!signedInRef.current) return;
      if (!slug || !Number.isFinite(episode)) return;
      if ((visibleRef.current.watched[slug] ?? []).includes(episode)) return;
      updateVisible((current) => {
        const numbers = [...new Set([...(current.watched[slug] ?? []), episode])].sort((a, b) => a - b);
        return { ...current, watched: { ...current.watched, [slug]: numbers } };
      });
      enqueueOperation({ id: newOperationId(), type: "watched", slug, episode, value: true });
    },
    [enqueueOperation, updateVisible],
  );

  const toggleWatched = useCallback(
    (slug: string, episode: number) => {
      if (!signedInRef.current) return;
      if (!slug || !Number.isFinite(episode)) return;
      const exists = (visibleRef.current.watched[slug] ?? []).includes(episode);
      updateVisible((current) => {
        const currentEpisodes = current.watched[slug] ?? [];
        const numbers = exists
          ? currentEpisodes.filter((number) => number !== episode)
          : [...new Set([...currentEpisodes, episode])].sort((a, b) => a - b);
        const nextWatched = { ...current.watched };
        if (numbers.length) nextWatched[slug] = numbers;
        else delete nextWatched[slug];
        return { ...current, watched: nextWatched };
      });
      enqueueOperation({ id: newOperationId(), type: "watched", slug, episode, value: !exists });
    },
    [enqueueOperation, updateVisible],
  );

  const isWatched = useCallback(
    (slug: string, episode: number) => Boolean(user && (watched[slug] ?? []).includes(episode)),
    [user, watched],
  );

  const lastWatched = useCallback(
    (slug: string) => {
      const episodes = user ? watched[slug] ?? [] : [];
      return episodes.length ? episodes[episodes.length - 1] : null;
    },
    [user, watched],
  );

  const value = useMemo(
    () => ({
      ready,
      user,
      favorites: user ? favorites : [],
      watched: user ? watched : {},
      library: user ? library : {},
      setLibraryStatus,
      toasts,
      login,
      register,
      logout,
      toggleFavorite,
      isFavorite,
      clearFavorites,
      markWatched,
      toggleWatched,
      isWatched,
      lastWatched,
      toast,
      dismissToast,
      canImportLocalPreferences,
      importLocalPreferences,
      pendingSyncCount,
      syncing,
      syncError,
    }),
    [
      ready,
      user,
      favorites,
      watched,
      library,
      setLibraryStatus,
      toasts,
      login,
      register,
      logout,
      toggleFavorite,
      isFavorite,
      clearFavorites,
      markWatched,
      toggleWatched,
      isWatched,
      lastWatched,
      toast,
      dismissToast,
      canImportLocalPreferences,
      importLocalPreferences,
      pendingSyncCount,
      syncing,
      syncError,
    ],
  );

  return (
    <AppContext.Provider value={value}>
      <TelegramNotifyProvider>
        <PwaProvider>
          <MotionConfig reducedMotion="user">
            <DownloadsProvider>
            {children}
            <DownloadCenter />
            <ToastViewport />
            </DownloadsProvider>
          </MotionConfig>
        </PwaProvider>
      </TelegramNotifyProvider>
    </AppContext.Provider>
  );
}
