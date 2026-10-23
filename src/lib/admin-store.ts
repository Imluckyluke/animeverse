"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdminPatchable, Anime } from "@/lib/catalog";

/**
 * Demo admin layer: everything lives in localStorage and is applied on top of
 * the static catalogue at render time (no backend in this preview).
 */
export type AdminState = {
  hidden: string[];
  pinned: string[];
  titles: Record<string, string>;
  scores: Record<string, number>;
  episodes: Record<string, number>;
};

export const ADMIN_KEY = "av_admin";

export const EMPTY_ADMIN: AdminState = {
  hidden: [],
  pinned: [],
  titles: {},
  scores: {},
  episodes: {},
};

export function readAdmin(): AdminState {
  if (typeof window === "undefined") return EMPTY_ADMIN;
  try {
    const raw = window.localStorage.getItem(ADMIN_KEY);
    if (!raw) return EMPTY_ADMIN;
    const parsed = JSON.parse(raw) as Partial<AdminState>;
    return {
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
      titles: parsed.titles ?? {},
      scores: parsed.scores ?? {},
      episodes: parsed.episodes ?? {},
    };
  } catch {
    return EMPTY_ADMIN;
  }
}

export function writeAdmin(next: AdminState) {
  try {
    window.localStorage.setItem(ADMIN_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("av-admin"));
  } catch {
    /* storage full / blocked */
  }
}

export function clearAdmin() {
  try {
    window.localStorage.removeItem(ADMIN_KEY);
    window.dispatchEvent(new Event("av-admin"));
  } catch {
    /* ignore */
  }
}

export function useAdminState(): AdminState {
  const [state, setState] = useState<AdminState>(EMPTY_ADMIN);

  useEffect(() => {
    const sync = () => setState(readAdmin());
    sync();
    window.addEventListener("av-admin", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("av-admin", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return state;
}

/** Applies admin overrides: hide, pin, and small field patches. */
export function applyAdmin<T extends AdminPatchable>(items: T[], state: AdminState): T[] {
  const hidden = new Set(state.hidden);
  const patched: T[] = items
    .filter((a) => !hidden.has(a.slug))
    .map((a) => {
      const title = state.titles[a.slug];
      const score = state.scores[a.slug];
      const episodes = state.episodes[a.slug];
      if (title === undefined && score === undefined && episodes === undefined) return a;
      return {
        ...a,
        titleEn: title ?? a.titleEn,
        score: score ?? a.score,
        episodes: episodes ?? a.episodes,
      };
    });

  if (!state.pinned.length) return patched;
  // Keep the newest star first. The admin prepends each new pin, so using the
  // array order (not just membership) means starring another title always
  // promotes that exact title into the first hero slide.
  const pinnedOrder = new Map(state.pinned.map((slug, index) => [slug, index]));
  return [...patched].sort((a, b) => {
    const ai = pinnedOrder.get(a.slug);
    const bi = pinnedOrder.get(b.slug);
    if (ai === undefined && bi === undefined) return 0;
    if (ai === undefined) return 1;
    if (bi === undefined) return -1;
    return ai - bi;
  });
}

/** Catalogue with the demo-admin overrides applied. */
export function useCatalog<T extends AdminPatchable>(items: T[]): T[] {
  const state = useAdminState();
  return useMemo(() => applyAdmin(items, state), [items, state]);
}
