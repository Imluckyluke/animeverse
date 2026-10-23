"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useApp } from "@/lib/app-context";

const CLIENT_KEY = "av_notify_client";

export type TelegramNotifyStatus = {
  linked: boolean;
  enabled: boolean;
  favoritesCount: number;
  botUsername: string;
};

type TelegramNotifyValue = {
  ready: boolean;
  status: TelegramNotifyStatus | null;
  busy: boolean;
  pending: boolean;
  connect: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  disconnect: () => Promise<void>;
};

const TelegramNotifyContext = createContext<TelegramNotifyValue | null>(null);

function makeClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `av-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function getStoredClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,100}$/.test(existing)) return existing;
    const created = makeClientId();
    localStorage.setItem(CLIENT_KEY, created);
    return created;
  } catch {
    return makeClientId();
  }
}

export function TelegramNotifyProvider({ children }: { children: ReactNode }) {
  const { ready: appReady, favorites, toast } = useApp();
  const [clientId, setClientId] = useState("");
  const [status, setStatus] = useState<TelegramNotifyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingUntil = useRef(0);
  const syncedFavorites = useRef("");

  useEffect(() => {
    setClientId(getStoredClientId());
  }, []);

  const refresh = useCallback(async () => {
    if (!clientId) return;
    try {
      const response = await fetch(
        `/api/notifications/status?clientId=${encodeURIComponent(clientId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setLoading(false);
        return;
      }
      const payload = (await response.json()) as TelegramNotifyStatus;
      setStatus(payload);
      setLoading(false);
      if (payload.linked) setPending(false);
    } catch {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    void refresh();
  }, [clientId, refresh]);

  useEffect(() => {
    const onFocus = () => {
      if (clientId) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [clientId, refresh]);

  useEffect(() => {
    if (!pending || !clientId) return;
    const timer = window.setInterval(() => {
      if (Date.now() > pendingUntil.current) {
        setPending(false);
        return;
      }
      void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [pending, clientId, refresh]);

  // Keep the server copy of favourites in sync while the chat is linked.
  useEffect(() => {
    if (!appReady || !clientId || !status?.linked || busy) return;
    const key = favorites.join("|");
    if (key === syncedFavorites.current) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/notifications/preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, favorites }),
        });
        if (!response.ok) return;
        const payload = (await response.json()) as TelegramNotifyStatus;
        setStatus(payload);
        syncedFavorites.current = key;
      } catch {
        /* retry on the next favourites change or page focus */
      }
    }, 850);
    return () => window.clearTimeout(timer);
  }, [appReady, clientId, status?.linked, busy, favorites]);

  const connect = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    // Open synchronously so iOS/Chrome do not treat it as a blocked popup.
    const popup = window.open("", "_blank");
    try {
      const response = await fetch("/api/notifications/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, favorites }),
      });
      const payload = (await response.json().catch(() => null)) as {
        url?: string;
        botUsername?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.url) {
        popup?.close();
        toast("اتصال انجام نشد", payload?.error || "کمی بعد دوباره تلاش کن.", "error");
        return;
      }
      if (popup) popup.location.href = payload.url;
      else window.location.href = payload.url;
      setStatus((current) => ({
        linked: current?.linked ?? false,
        enabled: true,
        favoritesCount: favorites.length,
        botUsername: payload.botUsername || current?.botUsername || "Anotifersbot",
      }));
      pendingUntil.current = Date.now() + 5 * 60 * 1000;
      setPending(true);
      toast("ربات تلگرام باز شد", "در ربات روی Start بزن؛ اتصال خودکار انجام می‌شود.");
      window.setTimeout(() => void refresh(), 2200);
    } catch {
      popup?.close();
      toast("اتصال انجام نشد", "ارتباط با سرور برقرار نشد.", "error");
    } finally {
      setBusy(false);
    }
  }, [busy, clientId, favorites, refresh, toast]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (!status?.linked) {
        await connect();
        return;
      }
      if (busy) return;
      setBusy(true);
      try {
        const response = await fetch("/api/notifications/preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, favorites, enabled }),
        });
        if (!response.ok) {
          toast("تنظیم اعلان انجام نشد", "کمی بعد دوباره تلاش کن.", "error");
          return;
        }
        const payload = (await response.json()) as TelegramNotifyStatus;
        setStatus(payload);
        if (enabled) syncedFavorites.current = favorites.join("|");
        toast(
          enabled ? "اعلان قسمت جدید روشن شد" : "اعلان قسمت جدید خاموش شد",
          enabled
            ? "قسمت تازهٔ انیمه‌های لایک‌شده در تلگرام برایت می‌آید."
            : "می‌تونی هر وقت خواستی دوباره روشنش کنی.",
          enabled ? "success" : "info",
        );
      } catch {
        toast("تنظیم اعلان انجام نشد", "ارتباط با سرور برقرار نشد.", "error");
      } finally {
        setBusy(false);
      }
    },
    [status?.linked, busy, clientId, favorites, connect, toast],
  );

  const disconnect = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/notifications/unlink?clientId=${encodeURIComponent(clientId)}`,
        { method: "DELETE" },
      );
      if (response.ok) {
        setStatus((current) => ({
          linked: false,
          enabled: false,
          favoritesCount: current?.favoritesCount ?? favorites.length,
          botUsername: current?.botUsername ?? "Anotifersbot",
        }));
        setPending(false);
        syncedFavorites.current = "";
        toast("اتصال تلگرام قطع شد", "هر وقت خواستی دوباره وصلش کن.", "info");
      }
    } catch {
      toast("قطع اتصال انجام نشد", "کمی بعد دوباره تلاش کن.", "error");
    } finally {
      setBusy(false);
    }
  }, [busy, clientId, favorites.length, toast]);

  return (
    <TelegramNotifyContext.Provider
      value={{
        ready: !loading,
        status,
        busy,
        pending,
        connect,
        setEnabled,
        refresh,
        disconnect,
      }}
    >
      {children}
    </TelegramNotifyContext.Provider>
  );
}

export function useTelegramNotify(): TelegramNotifyValue {
  const context = useContext(TelegramNotifyContext);
  if (!context) throw new Error("useTelegramNotify must be used inside <TelegramNotifyProvider>");
  return context;
}
