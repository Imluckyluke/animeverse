"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Loader2, Search, X } from "lucide-react";
import type { Anime } from "@/lib/catalog";
import { CoverImage } from "@/components/ui/cover-image";
import { cn, faDigits } from "@/lib/utils";
import { lockPageScroll } from "@/lib/scroll-lock";

type PaletteItem = Pick<Anime, "slug" | "title" | "titleEn" | "year" | "cover" | "banner">;
let cachedIndex: PaletteItem[] | null = null;
let indexRequest: Promise<PaletteItem[]> | null = null;
function loadIndex() {
  if (cachedIndex) return Promise.resolve(cachedIndex);
  if (!indexRequest) indexRequest = fetch("/api/catalog-search").then(async (response) => {
    if (!response.ok) throw new Error("search unavailable");
    cachedIndex = await response.json() as PaletteItem[];
    return cachedIndex;
  }).finally(() => { indexRequest = null; });
  return indexRequest;
}

/** Portalled outside transformed cards; sized to the keyboard's visual viewport. */
export function CommandPalette({ items, searchHref = "/browse", compact = false, shortcut = true }: {
  items?: PaletteItem[]; searchHref?: string; compact?: boolean; shortcut?: boolean;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const id = useId();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [remote, setRemote] = useState<PaletteItem[]>(cachedIndex ?? []);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [viewport, setViewport] = useState<{ top: number; height: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const show = useCallback(() => {
    setQuery("");
    setCursor(0);
    setFailed(false);
    setLoading(!items && !cachedIndex);
    if (!items && cachedIndex) setRemote(cachedIndex);
    setOpen(true);
  }, [items]);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (items) return;
    // Warm the small public index while idle, not during the opening animation.
    let idle = 0;
    const timer = window.setTimeout(() => {
      const warm = () => { void loadIndex().catch(() => {}); };
      if (window.requestIdleCallback) idle = window.requestIdleCallback(warm, { timeout: 2000 });
      else warm();
    }, 1200);
    return () => { clearTimeout(timer); if (idle) window.cancelIdleCallback(idle); };
  }, [items]);
  useEffect(() => {
    const opened = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false);
    };
    window.addEventListener("av-search-open", opened);
    return () => window.removeEventListener("av-search-open", opened);
  }, [id]);
  useEffect(() => {
    if (!open || items) return;
    let alive = true;
    setLoading(!cachedIndex);
    setFailed(false);
    loadIndex().then((data) => { if (alive) setRemote(data); })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, items, retry]);
  useEffect(() => {
    if (!shortcut) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.isContentEditable || target?.closest("input,textarea,select");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (openRef.current) setOpen(false);
        else show();
      } else if (!typing && event.key === "/") {
        event.preventDefault();
        if (!openRef.current) show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut, show]);

  useEffect(() => {
    if (!open) return;
    setPresent(true);
    setQuery("");
    setCursor(0);
  }, [open]);

  useEffect(() => {
    if (!present) return;
    window.dispatchEvent(new CustomEvent("av-search-open", { detail: id }));
    const unlock = lockPageScroll();
    let frame = 0;
    const sync = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const top = window.visualViewport?.offsetTop ?? 0;
        const height = window.visualViewport?.height ?? window.innerHeight;
        setViewport((previous) => previous && previous.top === top && previous.height === height ? previous : { top, height });
      });
    };
    sync();
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    // Do not open the mobile keyboard in the middle of the panel's entrance.
    const timer = window.setTimeout(() => {
      if (openRef.current) input.current?.focus({ preventScroll: true });
    }, reduce || matchMedia("(min-width: 640px)").matches ? 30 : 220);
    const trap = (event: KeyboardEvent) => {
      if (!openRef.current) return;
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
      if (event.key !== "Tab") return;
      const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]),input,a[href]',
      ) ?? []).filter((node) => node.offsetParent !== null);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const inside = panel.current?.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", trap);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      unlock();
      window.dispatchEvent(new CustomEvent("av-search-close", { detail: id }));
      if (!document.querySelector('[data-search-open="true"]')) launcher.current?.focus({ preventScroll: true });
    };
  }, [present, id, reduce]);

  const source = items ?? remote;
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("fa");
    return needle ? source.filter((item) => `${item.title} ${item.titleEn}`.toLocaleLowerCase("fa").includes(needle)) : source;
  }, [source, query]);
  const results = matches.slice(0, 6);
  useEffect(() => {
    if (open) document.getElementById(`${id}-${cursor}`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, open, id, query, results[cursor]?.slug]);

  const go = (anime?: PaletteItem) => {
    if (!anime) return;
    setOpen(false);
    router.push(`/anime/${anime.slug}`);
  };
  const all = () => {
    const url = new URL(searchHref, window.location.origin);
    if (query.trim()) url.searchParams.set("q", query.trim());
    setOpen(false);
    router.push(url.pathname + url.search);
  };

  return <>
    <button ref={launcher} type="button" onClick={show} aria-label="جست‌وجوی انیمه" aria-haspopup="dialog" aria-expanded={open}
      onPointerDown={() => { if (!items) void loadIndex().catch(() => {}); }}
      onPointerEnter={() => { if (!items) void loadIndex().catch(() => {}); }}
      onFocus={() => { if (!items) void loadIndex().catch(() => {}); }}
      className={compact ? "icon-btn size-11 shrink-0" : "flex h-14 w-full items-center gap-3 rounded-2xl border border-white/[0.12] bg-white/[0.04] px-4 text-right transition-colors hover:border-amber-400/40"}>
      <Search className="size-5 shrink-0 text-amber-300" />
      {!compact ? <span className="min-w-0 flex-1 truncate text-sm text-content-muted">جست‌وجو در آرشیو…</span> : null}
    </button>
    {mounted ? createPortal(<AnimatePresence onExitComplete={() => setPresent(false)}>{open ? (
      <div key="search-overlay" className="fixed inset-x-0 z-[220] flex items-start justify-center px-3 pb-3 pt-[6dvh] sm:px-6 sm:pb-6 sm:pt-[9dvh]"
        style={{ top: viewport?.top ?? 0, height: viewport?.height ?? "100dvh" }}
        onClick={() => setOpen(false)}>
        {/* Blur stays static. Only this tint and the small panel fade/move. */}
        <div aria-hidden className="search-backdrop pointer-events-none absolute inset-0" />
        <motion.div aria-hidden className="pointer-events-none absolute inset-0 bg-black/35"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.18 }} />
        <motion.div ref={panel} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}
          data-search-open={open ? "true" : "false"}
          className="relative flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-[22px] border border-white/15 bg-[rgba(13,13,20,.9)] shadow-[0_24px_64px_-20px_rgba(0,0,0,.75)]"
          initial={{ opacity: 0, y: reduce ? 0 : -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : -5 }}
          transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }} onClick={(event) => event.stopPropagation()}>
          <div className="flex shrink-0 items-center justify-between ps-4 pe-2 pt-1">
            <h2 id={`${id}-title`} className="text-xs font-bold text-content-soft">جست‌وجوی انیمه</h2>
            <button type="button" aria-label="بستن جست‌وجو" onClick={() => setOpen(false)} className="grid size-11 place-items-center rounded-full text-content-muted transition-colors hover:bg-white/5 hover:text-white"><X className="size-4" /></button>
          </div>
          <div className="mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3">
            <Search className="size-5 shrink-0 text-amber-300" />
            <input ref={input} role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-results`}
              aria-activedescendant={!loading && !failed && results[cursor] ? `${id}-${cursor}` : undefined}
              aria-label="نام انیمه" value={query} placeholder="نام فارسی یا انگلیسی…"
              onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") { event.preventDefault(); setCursor((value) => Math.min(Math.max(0, results.length - 1), value + 1)); }
                else if (event.key === "ArrowUp") { event.preventDefault(); setCursor((value) => Math.max(0, value - 1)); }
                else if (event.key === "Enter") { event.preventDefault(); if (event.ctrlKey || event.metaKey) all(); else go(results[cursor]); }
              }} className="h-11 min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-content-faint" />
          </div>
          <ul id={`${id}-results`} role="listbox" aria-label="نتایج جست‌وجو" className="min-h-0 max-h-[min(40dvh,320px)] flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
            {loading ? <li role="presentation" className="flex h-[min(40dvh,320px)] items-center justify-center gap-2 p-6 text-sm text-content-muted"><Loader2 className="size-5 animate-spin" /> در حال جست‌وجو…</li> : failed ? <li role="presentation" className="p-4 text-center"><button type="button" className="btn btn-glass btn-md" onClick={() => setRetry((value) => value + 1)}>دریافت فهرست ناموفق بود؛ تلاش دوباره</button></li> : !results.length ? <li role="presentation" className="px-3 py-8 text-center text-sm text-content-muted">چیزی پیدا نشد؛ نام دیگری را امتحان کن.</li> : results.map((anime, index) => (
              <li key={anime.slug} id={`${id}-${index}`} role="option" aria-selected={index === cursor}>
                <button type="button" tabIndex={-1} onMouseEnter={() => setCursor(index)} onClick={() => go(anime)}
                  className={cn("flex min-h-14 w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-right transition-colors", index === cursor ? "bg-amber-400/10" : "hover:bg-white/5")}>
                  <span className="relative h-11 w-8 shrink-0 overflow-hidden rounded-md"><CoverImage src={anime.cover ?? anime.banner ?? "/covers/placeholder.svg"} alt="" thumb sizes="32px" /></span>
                  <span className="min-w-0 flex-1"><span dir="ltr" className="block truncate text-right text-[13px] font-bold text-white">{anime.titleEn}</span><span className="mt-0.5 block truncate text-xs text-content-muted">{anime.title} · {faDigits(anime.year)}</span></span>
                  <ArrowLeft className="size-4 shrink-0 text-amber-300" />
                </button>
              </li>
            ))}
          </ul>
          <div className="shrink-0 border-t border-white/10 px-3 py-2">
            <button type="button" onClick={all} className="btn btn-md w-full border border-white/10 bg-white/[0.035] px-2 hover:bg-white/[0.07]"><span className="truncate">{query.trim() ? `همهٔ نتایج برای «${query.trim()}»` : "دیدن همهٔ آرشیو"}</span><span className="text-xs text-content-muted">({faDigits(matches.length)})</span><ArrowLeft className="size-4 shrink-0" /></button>
          </div>
        </motion.div>
      </div>
    ) : null}</AnimatePresence>, document.body) : null}
  </>;
}
