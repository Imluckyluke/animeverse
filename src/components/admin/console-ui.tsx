"use client";

import type { AdminCommand, AdminRole } from "@/lib/admin-contract";
import {
  AdminApiError,
  adminErrorMessage,
  getCommand,
  isAbortError,
  isUnauthorized,
} from "@/lib/admin-client";
import { isTopOverlay, pushOverlay } from "@/lib/overlay-stack";
import { lockPageScroll } from "@/lib/scroll-lock";
import { cn, faBytes, faNum } from "@/lib/utils";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/* ── Scoped skin ───────────────────────────────────────────────────────── */

const CONSOLE_CSS = `
.av-admin {
  color-scheme: dark;
  --av-white: 255 255 255;
  --av-ink-950: 6 6 9;
  --av-ink-900: 12 12 19;
  --av-ink-850: 23 23 31;
  --av-content: 245 247 255;
  --av-content-soft: 211 217 232;
  --av-content-muted: 154 164 186;
  --av-content-faint: 121 131 154;
  --av-amber-200: 255 243 176;
  --av-amber-300: 255 224 102;
  --av-gold-300: 255 224 138;
  --av-gold-400: 255 208 92;
  color: rgb(var(--av-content));
}
.av-admin.av-root {
  background: transparent;
}
.av-admin.av-admin ::selection { background: #ffd60a; color: #1a1206; }
.av-admin .av-card {
  border: 1px solid rgba(255,255,255,.10);
  background: var(--av-glass, rgba(255,255,255,.035));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.09), 0 24px 70px -42px rgba(0,0,0,.95);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  backdrop-filter: blur(14px) saturate(140%);
}
.av-admin .av-sub {
  border: 1px solid rgba(255,255,255,.075);
  background: rgba(255,255,255,.035);
}
.av-admin .av-violet {
  border-color: rgba(167,139,250,.26);
  background: rgba(124,82,211,.13);
  color: #c4b5fd;
}
.av-admin .av-amber {
  border-color: rgba(255,214,10,.30);
  background: rgba(255,214,10,.10);
  color: rgb(var(--av-amber-300));
}
.av-admin .av-danger {
  border-color: rgba(255,113,136,.32);
  background: rgba(255,113,136,.10);
  color: #ffb3c0;
}
.av-admin .av-success {
  border-color: rgba(61,220,151,.28);
  background: rgba(61,220,151,.09);
  color: #9df3cf;
}
.av-admin.av-admin :is(.field, input, textarea, select) {
  color: #f6f3ff;
  background-color: rgba(255,255,255,.055);
  border-color: rgba(255,255,255,.13);
  caret-color: #ffd60a;
}
.av-admin.av-admin :is(input, textarea)::placeholder { color: rgb(var(--av-content-faint)); opacity: 1; }
.av-admin.av-admin .field:focus,
.av-admin.av-admin :is(input, textarea, select):focus {
  border-color: rgba(255,214,10,.55);
  background-color: rgba(255,255,255,.075);
  outline: none;
  box-shadow: 0 0 0 4px rgba(255,214,10,.10);
}
.av-admin.av-admin select { background-color: #171326; }
.av-admin.av-admin option { color: #f6f3ff; background: #171326; }
.av-admin.av-admin .btn-glass {
  color: #f6f3ff;
  border-color: rgba(255,255,255,.14);
  background: rgba(255,255,255,.065);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.10);
}
.av-admin.av-admin .btn-ghost { color: rgb(var(--av-content-soft)); }
.av-admin.av-admin .btn-ghost:hover { color: #fff; background: rgba(255,255,255,.07); }
.av-admin.av-admin .chip {
  border-color: rgba(255,255,255,.12);
  background: rgba(255,255,255,.055);
  color: rgb(var(--av-content-soft));
}
.av-admin.av-admin .skeleton { background: rgba(255,255,255,.065); }
.av-admin .av-rule { height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.11), transparent); }
.av-admin .av-dialog-backdrop {
  background: rgba(4, 3, 9, .78);
  -webkit-backdrop-filter: blur(8px) saturate(120%);
  backdrop-filter: blur(8px) saturate(120%);
}
.av-admin.av-admin .av-dialog[role="dialog"] {
  border: 1px solid rgba(255,255,255,.14);
  background: linear-gradient(180deg, rgba(28,23,43,.985), rgba(10,8,17,.99));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 40px 120px -40px rgba(0,0,0,.98);
  color: rgb(var(--av-content));
}
.av-admin .av-dialog-body {
  scrollbar-color: rgba(255,255,255,.22) transparent;
  scrollbar-width: thin;
}
.av-admin :is(button,summary,a):focus-visible { outline: 2px solid rgb(var(--av-amber-300)); outline-offset: 3px; }
.av-admin details > summary { min-height: 44px; align-content: center; }
.av-admin details[open] > div { animation: av-console-in .2s ease-out; }
.av-admin .av-dialog-body::-webkit-scrollbar { width: 8px; }
.av-admin .av-dialog-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border: 2px solid transparent; border-radius: 99px; background-clip: content-box; }
.av-admin .av-login-hero {
  border: 1px solid rgba(255,255,255,.10);
  background: linear-gradient(150deg, rgba(49,35,82,.82), rgba(13,10,22,.94));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.10), 0 30px 90px -45px rgba(0,0,0,.95);
}
.av-admin .av-notice-error { border-color: rgba(255,113,136,.40); background: rgba(42,10,20,.94); }
.av-admin .av-notice-success { border-color: rgba(61,220,151,.32); background: rgba(9,32,25,.94); }
.av-admin .av-notice-info { border-color: rgba(167,139,250,.34); background: rgba(25,18,45,.94); }
.av-admin.av-admin :is(.text-danger, .text-success, .text-aqua-300) { color: #ffb3c0; }
.av-admin.av-admin .text-success { color: #9df3cf; }
.av-admin.av-admin .text-aqua-300 { color: #8ef0ff; }
.av-admin.av-admin :is(.text-amber-100, .text-amber-200, .text-amber-300) { color: #fde68a; }
.av-admin.av-admin :is(.text-violet-100, .text-violet-200, .text-violet-300) { color: #ddd6fe; }
.av-admin .av-media-checker {
  background-color: #100d1b;
  background-image: linear-gradient(45deg, rgba(255,255,255,.045) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,.045) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,.045) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,.045) 75%);
  background-size: 18px 18px;
  background-position: 0 0, 0 9px, 9px -9px, -9px 0;
}
html[data-theme="light"] .av-admin {
  color-scheme: light;
  --av-white: inherit; --av-ink-950: inherit; --av-ink-900: inherit; --av-ink-850: inherit;
  --av-content: inherit; --av-content-soft: inherit; --av-content-muted: inherit; --av-content-faint: inherit;
  --av-amber-200: inherit; --av-amber-300: inherit; --av-gold-300: inherit; --av-gold-400: inherit;
}
html[data-theme="light"] .av-admin .av-card { background: var(--av-glass); border-color: rgba(120,94,51,.17); box-shadow: var(--av-glass-shadow); }
html[data-theme="light"] .av-admin .av-sub { background: rgba(132,107,65,.045); border-color: rgba(120,94,51,.12); }
html[data-theme="light"] .av-admin.av-admin :is(.field,input,textarea,select,option) { color: rgb(var(--av-content)); background-color: rgba(255,253,246,.55); border-color: rgba(115,92,57,.22); caret-color: #916014; }
html[data-theme="light"] .av-admin.av-admin :is(.field,input,textarea,select):focus { background-color: rgba(255,253,246,.85); border-color: #af812d; box-shadow: 0 0 0 3px rgba(175,129,45,.12); }
html[data-theme="light"] .av-admin.av-admin .btn-glass { color: rgb(var(--av-content)); background: var(--av-glass); border-color: rgba(120,94,51,.2); box-shadow: var(--av-control-shadow); }
html[data-theme="light"] .av-admin.av-admin .btn-ghost:hover { color: rgb(var(--av-content)); background: rgba(120,94,51,.07); }
html[data-theme="light"] .av-admin.av-admin :is(.chip,.skeleton) { background: rgba(120,94,51,.065); border-color: rgba(120,94,51,.16); }
html[data-theme="light"] .av-admin .av-rule { background: linear-gradient(90deg,transparent,rgba(120,94,51,.18),transparent); }
html[data-theme="light"] .av-admin .av-dialog-backdrop { background: rgba(71,59,39,.25); }
html[data-theme="light"] .av-admin.av-admin .av-dialog[role="dialog"] { background: var(--av-menu-glass); color: rgb(var(--av-content)); border-color: rgba(120,94,51,.22); box-shadow: var(--av-glass-shadow); }
html[data-theme="light"] .av-admin .av-dialog-body { scrollbar-color: rgba(120,94,51,.35) transparent; }
html[data-theme="light"] .av-admin :is(.av-violet,.av-notice-info) { color: #654585; background: rgba(119,86,154,.08); border-color: rgba(119,86,154,.22); }
html[data-theme="light"] .av-admin :is(.av-amber,.av-login-hero) { color: #855709; background: rgba(180,134,37,.08); border-color: rgba(180,134,37,.24); }
html[data-theme="light"] .av-admin :is(.av-danger,.av-notice-error,.text-danger) { color: #a32642; background-color: rgba(192,48,78,.06); border-color: rgba(192,48,78,.22); }
html[data-theme="light"] .av-admin :is(.av-success,.av-notice-success,.text-success) { color: #176d4a; background-color: rgba(31,139,91,.06); border-color: rgba(31,139,91,.22); }
html[data-theme="light"] .av-admin.av-admin .text-aqua-300 { color: #166974; }
html[data-theme="light"] .av-admin.av-admin :is(.text-amber-100,.text-amber-200,.text-amber-300) { color: #855709; }
html[data-theme="light"] .av-admin.av-admin :is(.text-violet-100,.text-violet-200,.text-violet-300) { color: #654585; }
html[data-theme="light"] .av-admin .av-media-checker { background-color: #eee8dc; }
@keyframes av-console-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
.av-admin .av-enter { animation: av-console-in .22s cubic-bezier(.16,1,.3,1) both; }
@media (prefers-reduced-motion: reduce) {
  .av-admin .av-enter, .av-admin details[open] > div { animation: none; }
  .av-admin * { scroll-behavior: auto !important; }
}
`;

export function ConsoleSkin() {
  return <style dangerouslySetInnerHTML={{ __html: CONSOLE_CSS }} />;
}

/* ── Small hooks ───────────────────────────────────────────────────────── */

export function useDebouncedValue<T>(value: T, delay = 320): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export function useNow(interval = 15000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [interval]);
  return now;
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value <= 0) return "۰ بایت";
  return faBytes(value) || "—";
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const stamp = Date.parse(iso);
  if (!Number.isFinite(stamp)) return "—";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      timeZone: "Asia/Tehran",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(stamp));
  } catch {
    return "—";
  }
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : faNum(value);
}

/* ── Command polling ───────────────────────────────────────────────────── */

export function useCommandPoll(input: {
  commandId: string | null;
  onUnauthorized: () => void;
  onSettled?: (command: AdminCommand) => void;
}) {
  const { commandId, onUnauthorized, onSettled } = input;
  const [command, setCommand] = useState<AdminCommand | null>(null);
  const [error, setError] = useState("");
  const unauthorizedRef = useRef(onUnauthorized);
  const settledRef = useRef(onSettled);
  unauthorizedRef.current = onUnauthorized;
  settledRef.current = onSettled;

  useEffect(() => {
    if (!commandId) {
      setCommand(null);
      setError("");
      return;
    }

    let cancelled = false;
    let timer = 0;
    let current: AbortController | null = null;
    let done = false;
    setCommand(null);
    setError("");

    const schedule = (delay: number) => {
      if (cancelled || document.visibilityState === "hidden") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      current?.abort();
      const controller = new AbortController();
      current = controller;
      try {
        const next = await getCommand(commandId, controller.signal);
        if (cancelled || controller.signal.aborted) return;
        setCommand(next);
        setError("");
        if (next.state === "applied" || next.state === "failed") {
          if (!done) {
            done = true;
            settledRef.current?.(next);
          }
          return;
        }
        schedule(2500);
      } catch (failure) {
        if (cancelled || isAbortError(failure)) return;
        if (isUnauthorized(failure)) {
          unauthorizedRef.current();
          return;
        }
        setError(adminErrorMessage(failure, "وضعیت فرمان دریافت نشد."));
        if (
          failure instanceof AdminApiError &&
          failure.status >= 400 &&
          failure.status < 500 &&
          failure.status !== 408 &&
          failure.status !== 429
        ) {
          return;
        }
        schedule(4000);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        window.clearTimeout(timer);
        current?.abort();
      } else if (!done) {
        void tick();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      current?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [commandId]);

  return { command, error };
}

/* ── Dialog / confirmation ─────────────────────────────────────────────── */

export function ConsoleDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
  closeDisabled = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
  closeDisabled?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef(onClose);
  const disabledRef = useRef(closeDisabled);
  closeRef.current = onClose;
  disabledRef.current = closeDisabled;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !mounted) return;
    const token = Symbol("console-dialog");
    const releaseOverlay = pushOverlay(token);
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);

    const focusTimer = window.setTimeout(() => {
      if (!isTopOverlay(token)) return;
      const first = focusables()[0];
      (first ?? panelRef.current)?.focus({ preventScroll: true });
    }, 30);

    const onKey = (event: KeyboardEvent) => {
      if (!isTopOverlay(token)) return;
      if (event.key === "Escape") {
        if (!disabledRef.current) {
          event.preventDefault();
          closeRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = Boolean(active && panel.contains(active));
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const unlock = lockPageScroll();
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      releaseOverlay();
      unlock();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, mounted]);

  if (!open || !mounted) return null;

  // The console is nested in <main class="z-10">, while the mobile dock is a
  // z-75 sibling. A fixed sheet rendered in place stays inside that stacking
  // context, so portal it to <body> where its own layer can clear the dock.
  return createPortal(
    <div
      dir="rtl"
      data-console-overlay=""
      className="av-admin fixed inset-0 z-[140] flex items-end justify-center p-0 sm:items-center sm:p-6"
    >
      <button
        type="button"
        aria-label="بستن گفتگو"
        tabIndex={-1}
        onClick={() => {
          if (!closeDisabled) onClose();
        }}
        className="av-dialog-backdrop absolute inset-0 cursor-default"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "av-dialog av-enter relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-4xl sm:rounded-4xl",
          width === "lg" ? "sm:max-w-3xl" : width === "md" ? "sm:max-w-xl" : "sm:max-w-md",
        )}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/20 sm:hidden" />
        <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-3 pt-4 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-black text-white">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-[11.5px] leading-6 text-content-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="بستن"
            className="grid size-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-content-muted transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>
        <div
          className={cn(
            "av-dialog-body mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5",
            footer ? "pb-4" : "pb-[calc(env(safe-area-inset-bottom)+1rem)]",
          )}
        >
          {children}
        </div>
        {footer ? (
          <div className="shrink-0 border-t border-white/[0.08] bg-black/15 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 sm:px-5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export type ConfirmNote = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  hint?: string;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "تأیید",
  tone = "primary",
  busy = false,
  error,
  note,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  error?: string;
  note?: ConfirmNote;
  children?: ReactNode;
}) {
  const missing = Boolean(
    note?.required && note.value.trim().length < Math.max(1, note.minLength ?? 1),
  );
  return (
    <ConsoleDialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width="sm"
      closeDisabled={busy}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn btn-ghost btn-md">
            انصراف
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || missing}
            className={cn("btn btn-md", tone === "danger" ? "bg-danger text-[#21070d] hover:bg-[#ff8fa1]" : "btn-primary")}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? "در حال ثبت…" : confirmLabel}
          </button>
        </div>
      }
    >
      <div className="space-y-3 pb-1">
        <span
          className={cn(
            "grid size-11 place-items-center rounded-2xl border",
            tone === "danger" ? "av-danger" : "av-amber",
          )}
        >
          <AlertTriangle className="size-5" />
        </span>
        {children}
        {note ? (
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-semibold text-content-soft">
              {note.label ?? "یادداشت"}
              {note.required ? <span className="text-danger"> *</span> : null}
            </span>
            <textarea
              value={note.value}
              onChange={(event) => note.onChange(event.target.value)}
              placeholder={note.placeholder}
              rows={3}
              className="field min-h-[92px] resize-y py-2.5 text-[12.5px] leading-6"
            />
            {note.hint ? (
              <span className="mt-1 block text-[10.5px] leading-5 text-content-faint">{note.hint}</span>
            ) : null}
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[11.5px] leading-6 text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </ConsoleDialog>
  );
}

/* ── Shared visual primitives ──────────────────────────────────────────── */

export function ConsoleCard({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return <Tag className={cn("av-card rounded-3xl", className)}>{children}</Tag>;
}

export function SectionHeading({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? (
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-violet-300/20 bg-violet-400/10 text-violet-200">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[15px] font-black text-white">{title}</h2>
          {description ? (
            <p className="mt-1 text-[11.5px] leading-6 text-content-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function StatusChip({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "amber" | "violet" | "success" | "danger" | "info";
  className?: string;
}) {
  const toneClass =
    tone === "amber"
      ? "av-amber"
      : tone === "violet"
        ? "av-violet"
        : tone === "success"
          ? "av-success"
          : tone === "danger"
            ? "av-danger"
            : tone === "info"
              ? "border-aqua-500/25 bg-aqua-500/10 text-aqua-300"
              : "border-white/10 bg-white/[0.05] text-content-soft";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold leading-4",
        toneClass,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function RoleBadge({ role }: { role: string }) {
  const tone =
    role === "owner" ? "amber" : role === "editor" ? "violet" : role === "reviewer" ? "info" : "neutral";
  return <StatusChip tone={tone}>{roleLabel(role)}</StatusChip>;
}

export function roleLabel(role: string): string {
  if (role === "owner") return "مالک";
  if (role === "editor") return "ویرایشگر";
  if (role === "reviewer") return "بازبین";
  if (role === "user") return "کاربر";
  return role || "نامشخص";
}

export function commandStateMeta(state: AdminCommand["state"] | string): {
  label: string;
  tone: "neutral" | "amber" | "success" | "danger" | "violet";
} {
  if (state === "pending") return { label: "در صف", tone: "amber" };
  if (state === "running") return { label: "در حال اجرا", tone: "violet" };
  if (state === "applied") return { label: "اعمال شد", tone: "success" };
  if (state === "failed") return { label: "ناموفق", tone: "danger" };
  return { label: state || "نامشخص", tone: "neutral" };
}

export function BusyButton({
  busy,
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button {...props} disabled={props.disabled || busy} className={cn(className, busy && "cursor-wait")}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

/* ── Async states / paging ─────────────────────────────────────────────── */

export function InlineError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[11.5px] leading-6 text-danger",
        className,
      )}
    >
      <span className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span>{message}</span>
      </span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn btn-glass btn-sm text-white">
          <RefreshCw className="size-3.5" />
          تلاش دوباره
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-plate rounded-3xl border border-dashed border-white/[0.13] px-5 py-10 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] text-content-faint">
        <Inbox className="size-5" />
      </span>
      <p className="mt-3 text-[13px] font-bold text-white">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-[11.5px] leading-6 text-content-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-label="در حال بارگذاری" role="status">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton h-16 rounded-2xl" />
      ))}
    </div>
  );
}

export function Pager({
  page,
  total,
  pageSize,
  onPage,
  busy = false,
  label = "صفحه",
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  busy?: boolean;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (total <= 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <p className="text-[10.5px] text-content-faint" aria-live="polite">
        {label} {faNum(Math.max(1, page))} از {faNum(pages)} · {faNum(total)} مورد
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={busy || page <= 1}
          className="btn btn-glass btn-sm"
          aria-label="صفحهٔ قبل"
        >
          <ChevronRight className="size-3.5" />
          قبل
        </button>
        <button
          type="button"
          onClick={() => onPage(Math.min(pages, page + 1))}
          disabled={busy || page >= pages}
          className="btn btn-glass btn-sm"
          aria-label="صفحهٔ بعد"
        >
          بعد
          <ChevronLeft className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  busy = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  busy?: boolean;
}) {
  return (
    <label className="relative block w-full sm:max-w-xs">
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="field h-10 pe-4 ps-10 text-[12px] [&::-webkit-search-cancel-button]:hidden"
      />
      {busy ? (
        <Loader2 className="pointer-events-none absolute right-3.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-amber-300" />
      ) : (
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-content-faint">
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.2-3.2" strokeLinecap="round" />
          </svg>
        </span>
      )}
    </label>
  );
}

/* ── Permissions (UI only; the server remains authoritative) ───────────── */

export type ConsoleNotice = (title: string, description?: string, tone?: "success" | "error" | "info") => void;

export type ConsolePermissions = {
  role: AdminRole;
  canEditCatalog: boolean;
  canPublish: boolean;
  canReview: boolean;
  canManageUsers: boolean;
  canManageSettings: boolean;
  canUndo: boolean;
};

export function permissionsFor(role: AdminRole): ConsolePermissions {
  return {
    role,
    canEditCatalog: role === "owner" || role === "editor",
    canPublish: role === "owner" || role === "editor",
    canReview: true,
    canManageUsers: role === "owner",
    canManageSettings: role === "owner",
    canUndo: role === "owner",
  };
}

const PermissionsContext = createContext<ConsolePermissions | null>(null);

export function PermissionsProvider({
  value,
  children,
}: {
  value: ConsolePermissions;
  children: ReactNode;
}) {
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions(): ConsolePermissions {
  const value = useContext(PermissionsContext);
  if (!value) throw new Error("usePermissions must be used inside the admin console");
  return value;
}

export function errorText(error: unknown, fallback?: string): string {
  if (error instanceof AdminApiError) return error.message;
  return adminErrorMessage(error, fallback);
}
