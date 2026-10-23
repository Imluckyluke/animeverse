"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/lib/app-context";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type InstallResult = "accepted" | "dismissed" | "ios" | "manual" | "installed";

type PwaValue = {
  installed: boolean;
  canPrompt: boolean;
  ios: boolean;
  install: () => Promise<InstallResult>;
};

const PwaContext = createContext<PwaValue | null>(null);

export function PwaProvider({ children }: { children: ReactNode }) {
  const { toast } = useApp();
  const [promptEvent, setPromptEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  // A new build finished downloading in the background; tell the reader once.
  useEffect(() => {
    const onReady = () =>
      toast(
        "نسخهٔ تازهٔ انیمهورس آماده است",
        "برای دیدن تغییرها، صفحه را یک بار رفرش کن.",
        "info",
      );
    window.addEventListener("animeverse:update-ready", onReady);
    return () => window.removeEventListener("animeverse:update-ready", onReady);
  }, [toast]);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
    setInstalled(standalone);
    setIos(/iPad|iPhone|iPod/.test(window.navigator.userAgent));

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    let waiting: ServiceWorker | null = null;
    let toldOnce = false;

    // Tell the reader once per session that a new build is ready, then let the
    // worker take over the next time the tab is hidden — never mid-read.
    const announce = () => {
      if (toldOnce || !waiting) return;
      toldOnce = true;
      window.dispatchEvent(new CustomEvent("animeverse:update-ready"));
    };
    const promote = () => {
      waiting?.postMessage({ type: "SKIP_WAITING" });
    };

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          if (registration.waiting && navigator.serviceWorker.controller) {
            waiting = registration.waiting;
            announce();
          }
          registration.addEventListener("updatefound", () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener("statechange", () => {
              if (installing.state !== "installed") return;
              if (!navigator.serviceWorker.controller) return;
              waiting = registration.waiting ?? installing;
              announce();
            });
          });
        })
        .catch(() => {
          /* installability still works in browsers that do not use the SW */
        });

      const onHidden = () => {
        if (document.visibilityState === "hidden") promote();
      };
      document.addEventListener("visibilitychange", onHidden);
      return () => {
        document.removeEventListener("visibilitychange", onHidden);
        window.removeEventListener("beforeinstallprompt", onPrompt);
        window.removeEventListener("appinstalled", onInstalled);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<InstallResult> => {
    if (installed) return "installed";
    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      setPromptEvent(null);
      if (choice.outcome === "accepted") {
        setInstalled(true);
        return "accepted";
      }
      return "dismissed";
    }
    if (ios) return "ios";
    return "manual";
  }, [installed, promptEvent, ios]);

  return (
    <PwaContext.Provider value={{ installed, canPrompt: Boolean(promptEvent), ios, install }}>
      {children}
    </PwaContext.Provider>
  );
}

export function usePwa(): PwaValue {
  const context = useContext(PwaContext);
  if (!context) throw new Error("usePwa must be used inside <PwaProvider>");
  return context;
}
