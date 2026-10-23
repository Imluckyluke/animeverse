"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

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
  const [promptEvent, setPromptEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

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

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        /* installability still works in browsers that do not use the SW */
      });
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
