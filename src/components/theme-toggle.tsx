"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

const KEY = "av_theme";
const subscribeReady = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
function snapshot() { return document.documentElement.dataset.theme === "light"; }
function subscribe(notify: () => void) {
  const sync = () => {
    try { document.documentElement.dataset.theme = localStorage.getItem(KEY) === "dark" ? "dark" : "light"; } catch { /* Keep the current choice when storage is blocked. */ }
    updateChrome();
    notify();
  };
  window.addEventListener("av-theme", notify);
  window.addEventListener("storage", sync);
  return () => { window.removeEventListener("av-theme", notify); window.removeEventListener("storage", sync); };
}
function updateChrome() {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", snapshot() ? "#eee9df" : "#060609");
}

export function ThemeToggle() {
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverReady);
  const light = useSyncExternalStore(subscribe, snapshot, () => true);
  useEffect(updateChrome, [light]);
  const toggle = () => {
    const next = !snapshot();
    document.documentElement.dataset.theme = next ? "light" : "dark";
    try { localStorage.setItem(KEY, next ? "light" : "dark"); } catch { /* Still works for this visit. */ }
    updateChrome();
    window.dispatchEvent(new Event("av-theme"));
  };
  return <button type="button" onClick={toggle} disabled={!ready} aria-label={light ? "فعال کردن تم تیره" : "فعال کردن تم روشن"} aria-pressed={light} title={light ? "تم تیره" : "تم روشن"} className="theme-toggle icon-btn size-11 shrink-0 motion-reduce:transition-none">
    <Sun aria-hidden className="theme-sun size-5 text-amber-300" />
    <Moon aria-hidden className="theme-moon size-5 text-amber-300" />
  </button>;
}
