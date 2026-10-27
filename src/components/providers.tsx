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
import { LIBRARY_LABELS, parseLibrary, type LibraryState, type LibraryStatus } from "@/lib/library";

const LS = {
  user: "av_user",
  favorites: "av_favorites",
  accounts: "av_accounts",
  watched: "av_watched",
  library: "av_library",
};

type StoredAccount = {
  name: string;
  email: string;
  /** SHA-256(salt:password) — the plaintext is never kept. */
  hash?: string;
  salt?: string;
  /** Legacy plaintext from older builds; migrated to hash on the next login. */
  password?: string;
};

function readAccounts(): StoredAccount[] {
  try {
    const raw = localStorage.getItem(LS.accounts);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as StoredAccount[]) : [];
  } catch {
    return [];
  }
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(account: StoredAccount, password: string): Promise<boolean> {
  if (account.salt && account.hash) {
    return (await hashPassword(password, account.salt)) === account.hash;
  }
  return account.password === password;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function Providers({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [watched, setWatched] = useState<Record<string, number[]>>({});
  const [library, setLibrary] = useState<LibraryState>({});
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(1);
  const toastTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    try {
      const storedUser = localStorage.getItem(LS.user);
      if (storedUser) setUser(JSON.parse(storedUser) as User);
      const storedFav = localStorage.getItem(LS.favorites);
      if (storedFav) {
        const parsed = JSON.parse(storedFav) as unknown;
        if (Array.isArray(parsed)) setFavorites(parsed.filter((x): x is string => typeof x === "string"));
      }
      const storedWatched = localStorage.getItem(LS.watched);
      if (storedWatched) {
        const parsed = JSON.parse(storedWatched) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const next: Record<string, number[]> = {};
          for (const [slug, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!Array.isArray(value)) continue;
            const episodes = value
              .filter((item): item is number => typeof item === "number" && Number.isFinite(item))
              .sort((a, b) => a - b);
            if (episodes.length) next[slug] = [...new Set(episodes)];
          }
          setWatched(next);
        }
      }
      const storedLibrary = localStorage.getItem(LS.library);
      if (storedLibrary) setLibrary(parseLibrary(JSON.parse(storedLibrary)));
    } catch {
      /* ignore corrupted storage */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      if (user) localStorage.setItem(LS.user, JSON.stringify(user));
      else localStorage.removeItem(LS.user);
    } catch {
      /* ignore */
    }
  }, [ready, user]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(LS.favorites, JSON.stringify(favorites));
    } catch {
      /* ignore */
    }
  }, [ready, favorites]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(LS.watched, JSON.stringify(watched));
    } catch {
      /* ignore */
    }
  }, [ready, watched]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(LS.library, JSON.stringify(library)); } catch { /* Storage may be unavailable. */ }
  }, [ready, library]);

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

  const login = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      await delay(500);
      const normalized = email.trim().toLowerCase();
      const account = readAccounts().find((a) => a.email.toLowerCase() === normalized);

      if (!account || !(await verifyPassword(account, password))) {
        return { ok: false, error: "ایمیل یا رمز عبور درست نیست." };
      }

      // Upgrade a legacy plaintext record to a salted hash.
      if (account.password) {
        try {
          const salt = randomSalt();
          const hash = await hashPassword(password, salt);
          const next = readAccounts().map((a) =>
            a.email.toLowerCase() === normalized ? { name: a.name, email: a.email, salt, hash } : a,
          );
          localStorage.setItem(LS.accounts, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }

      const nextUser: User = {
        name: account.name,
        email: account.email,
        joinedAt: new Date().toISOString(),
      };
      setUser(nextUser);
      toast(
        "خوش برگشتی، " + account.name.split(" ")[0] + "!",
        "حسابت روی همین دستگاه ذخیره شده است.",
      );
      return { ok: true };
    },
    [toast],
  );

  const register = useCallback(
    async (name: string, email: string, password: string): Promise<AuthResult> => {
      await delay(700);
      const normalized = email.trim().toLowerCase();
      if (readAccounts().some((a) => a.email.toLowerCase() === normalized)) {
        return { ok: false, error: "این ایمیل قبلاً ثبت شده است." };
      }
      let account: StoredAccount;
      try {
        const salt = randomSalt();
        account = {
          name: name.trim(),
          email: normalized,
          salt,
          hash: await hashPassword(password, salt),
        };
        localStorage.setItem(LS.accounts, JSON.stringify([...readAccounts(), account]));
      } catch {
        return { ok: false, error: "ذخیرهٔ حساب در این مرورگر ممکن نشد." };
      }
      setUser({ name: account.name, email: account.email, joinedAt: new Date().toISOString() });
      toast("حساب ساخته شد", "خوش آمدی؛ حسابت فقط روی همین دستگاه ذخیره می‌شود.");
      return { ok: true };
    },
    [toast],
  );

  const logout = useCallback(() => {
    setUser(null);
    toast("از حساب خارج شدی", "هر وقت خواستی برگرد؛ آرشیو منتظرت است.", "info");
  }, [toast]);

  const toggleFavorite = useCallback(
    (slug: string) => {
      const exists = favorites.includes(slug);
      setFavorites((prev) =>
        prev.includes(slug) ? prev.filter((s) => s !== slug) : [slug, ...prev],
      );
      // Toast outside the updater: an updater must stay pure, or a replayed
      // render fires the message twice (and the toast visibly blinks).
      if (exists) {
        toast("از علاقه‌مندی‌ها حذف شد", "می‌توانی بعداً دوباره اضافه‌اش کنی.", "info");
      } else {
        toast("به علاقه‌مندی‌ها اضافه شد", "لیست شخصی‌ات ذخیره شد.");
      }
    },
    [favorites, toast],
  );

  const isFavorite = useCallback((slug: string) => favorites.includes(slug), [favorites]);

  const setLibraryStatus = useCallback((slug: string, status: LibraryStatus | null) => {
    if (!slug) return;
    setLibrary(previous => {
      const next = { ...previous };
      if (status === null) delete next[slug];
      else next[slug] = status;
      return next;
    });
    toast(status ? `به «${LIBRARY_LABELS[status]}» منتقل شد` : "از دسته‌بندی برداشته شد", "پیشرفت قسمت‌ها و علاقه‌مندی‌ها محفوظ می‌مانند.", "info");
  }, [toast]);

  const clearFavorites = useCallback(() => {
    setFavorites([]);
    toast("لیست علاقه‌مندی‌ها خالی شد", "یک شروع تازه برای کشف انیمه‌های بعدی.", "info");
  }, [toast]);

  const markWatched = useCallback((slug: string, episode: number) => {
    if (!slug || !Number.isFinite(episode)) return;
    setWatched((prev) => {
      const current = prev[slug] ?? [];
      if (current.includes(episode)) return prev;
      return { ...prev, [slug]: [...current, episode].sort((a, b) => a - b) };
    });
  }, []);

  const toggleWatched = useCallback((slug: string, episode: number) => {
    if (!slug || !Number.isFinite(episode)) return;
    setWatched((previous) => {
      const current = previous[slug] ?? [];
      return { ...previous, [slug]: current.includes(episode)
        ? current.filter((number) => number !== episode)
        : [...current, episode].sort((a, b) => a - b) };
    });
  }, []);

  const isWatched = useCallback(
    (slug: string, episode: number) => (watched[slug] ?? []).includes(episode),
    [watched],
  );

  const lastWatched = useCallback(
    (slug: string) => {
      const episodes = watched[slug] ?? [];
      return episodes.length ? episodes[episodes.length - 1] : null;
    },
    [watched],
  );

  const value = useMemo(
    () => ({
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
