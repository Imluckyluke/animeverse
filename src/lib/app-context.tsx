"use client";

import { createContext, useContext } from "react";

export type User = {
  name: string;
  email: string;
  joinedAt: string;
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
  toasts: ToastItem[];
  login: (email: string, password: string) => Promise<AuthResult>;
  register: (name: string, email: string, password: string) => Promise<AuthResult>;
  logout: () => void;
  toggleFavorite: (slug: string) => void;
  isFavorite: (slug: string) => boolean;
  clearFavorites: () => void;
  markWatched: (slug: string, episode: number) => void;
  isWatched: (slug: string, episode: number) => boolean;
  lastWatched: (slug: string) => number | null;
  toast: (title: string, description?: string, tone?: ToastItem["tone"]) => void;
  dismissToast: (id: number) => void;
};

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useApp must be used inside <Providers>");
  }
  return ctx;
}
