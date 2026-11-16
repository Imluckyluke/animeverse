"use client";

import { createContext, useContext } from "react";
import type { LibraryState, LibraryStatus } from "@/lib/library";

/**
 * Roles come from the server session only. A device-local profile (or a
 * matching email) never grants anything on its own.
 */
export type UserRole = "user" | "owner" | "editor" | "reviewer";

export type User = {
  /** Server account id. Local demo accounts from older builds have none. */
  id?: string;
  name: string;
  email: string;
  joinedAt: string;
  /** Server-assigned role; the API is authoritative, never the email. */
  role?: UserRole;
  /** Verified only against a legacy account on this device; never server staff. */
  localOnly?: boolean;
};

export type ToastItem = {
  id: number;
  title: string;
  description?: string;
  tone?: "success" | "info" | "error";
};

export type AuthResult = { ok: true } | { ok: false; error: string };

export type AppContextValue = {
  ready: boolean;
  user: User | null;
  favorites: string[];
  watched: Record<string, number[]>;
  library: LibraryState;
  setLibraryStatus: (slug: string, status: LibraryStatus | null) => void;
  toasts: ToastItem[];
  login: (email: string, password: string) => Promise<AuthResult>;
  register: (name: string, email: string, password: string) => Promise<AuthResult>;
  logout: () => void;
  toggleFavorite: (slug: string) => void;
  isFavorite: (slug: string) => boolean;
  clearFavorites: () => void;
  markWatched: (slug: string, episode: number) => void;
  toggleWatched: (slug: string, episode: number) => void;
  isWatched: (slug: string, episode: number) => boolean;
  lastWatched: (slug: string) => number | null;
  toast: (title: string, description?: string, tone?: ToastItem["tone"]) => void;
  dismissToast: (id: number) => void;
  /** True when the one-time local backup belongs to the signed-in account. */
  canImportLocalPreferences: boolean;
  /** Explicit, user-triggered move of the local backup into the account. */
  importLocalPreferences: () => Promise<AuthResult>;
  /** Changes waiting to reach the server (0 while signed out). */
  pendingSyncCount: number;
  syncing: boolean;
  /** Last cloud-sync failure, shown verbatim in the account panel. */
  syncError: string | null;
};

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useApp must be used inside <Providers>");
  }
  return ctx;
}
