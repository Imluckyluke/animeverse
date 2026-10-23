"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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

  useEffect(() => setMounted(true), []);
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
    setLoading(true);
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
        setOpen((value) => !value);
      } else if (!typing && event.key === "/") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent("av-search-open", { detail: id }));
    setQuery("");
    setCursor(0);
    const unlock = lockPageScroll();
    const sync = () => setViewport({
      top: window.visualViewport?.offsetTop ?? 0,
      height: window.visualViewport?.height ?? window.innerHeight,
    });
    sync();
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    const timer = window.setTimeout(() => input.current?.focus({ preventScroll: true }), 40);
    const trap = (event: KeyboardEvent) => {
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
      document.removeEventListener("keydown", trap);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      unlock();
      launcher.current?.focus({ preventScroll: true });
    };
  }, [open, id]);

  const source = items ?? remote;
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("fa");
    return needle ? source.filter((item) => `${item.title} ${item.titleEn}`.toLocaleLowerCase("fa").includes(needle)) : source;
  }, [source, query]);
  const results = matches.slice(0, 8);
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
    <button ref={launcher} type="button" onClick={() => setOpen(true)} aria-label="جست‌وجوی انیمه" aria-haspopup="dialog" aria-expanded={open}
      className={compact ? "icon-btn size-11 shrink-0" : "flex h-14 w-full items-center gap-3 rounded-2xl border border-white/[0.12] bg-white/[0.04] px-4 text-right transition-colors hover:border-amber-400/40"}>
      <Search className="size-5 shrink-0 text-amber-300" />
      {!compact ? <span className="min-w-0 flex-1 truncate text-sm text-content-muted">جست‌وجو در آرشیو…</span> : null}
    </button>
    {mounted ? createPortal(<AnimatePresence>{open ? (
      <motion.div className="fixed inset-x-0 z-[220] flex items-start justify-center bg-black/70 p-2 sm:p-6 sm:pt-[8dvh]"
        style={{ top: viewport?.top ?? 0, height: viewport?.height ?? "100dvh" }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: reduce ? 0 : 0.16 }} onClick={() => setOpen(false)}>
        <motion.div ref={panel} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}
          className="flex max-h-full w-full flex-col overflow-hidden rounded-3xl border border-white/15 bg-[#0d0d14] shadow-lift sm:max-w-xl"
          initial={{ y: reduce ? 0 : -10 }} animate={{ y: 0 }} exit={{ y: reduce ? 0 : -6 }}
          transition={{ duration: reduce ? 0 : 0.2 }} onClick={(event) => event.stopPropagation()}>
          <div className="flex shrink-0 items-center justify-between px-4 pt-3">
            <h2 id={`${id}-title`} className="text-sm font-bold text-white">جست‌وجوی انیمه</h2>
            <button type="button" aria-label="بستن جست‌وجو" onClick={() => setOpen(false)} className="icon-btn size-11"><X className="size-5" /></button>
          </div>
          <div className="m-3 flex shrink-0 items-center gap-3 rounded-xl border border-white/15 bg-white/[0.04] px-3">
            <Search className="size-5 shrink-0 text-amber-300" />
            <input ref={input} role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-results`}
              aria-activedescendant={results[cursor] ? `${id}-${cursor}` : undefined}
              aria-label="نام انیمه" value={query} placeholder="نام فارسی یا انگلیسی…"
              onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") { event.preventDefault(); setCursor((value) => Math.min(Math.max(0, results.length - 1), value + 1)); }
                else if (event.key === "ArrowUp") { event.preventDefault(); setCursor((value) => Math.max(0, value - 1)); }
                else if (event.key === "Enter") { event.preventDefault(); if (event.ctrlKey || event.metaKey) all(); else go(results[cursor]); }
              }} className="h-12 min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-content-faint" />
          </div>
          <ul id={`${id}-results`} role="listbox" aria-label="نتایج جست‌وجو" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 sm:max-h-[50dvh]">
            {loading ? <li role="presentation" className="flex justify-center gap-2 p-6 text-sm text-content-muted"><Loader2 className="size-5 animate-spin" /> در حال جست‌وجو…</li> : failed ? <li role="presentation" className="p-4 text-center"><button type="button" className="btn btn-glass btn-md" onClick={() => setRetry((value) => value + 1)}>دریافت فهرست ناموفق بود؛ تلاش دوباره</button></li> : !results.length ? <li role="presentation" className="px-3 py-8 text-center text-sm text-content-muted">چیزی پیدا نشد؛ نام دیگری را امتحان کن.</li> : results.map((anime, index) => (
              <li key={anime.slug} id={`${id}-${index}`} role="option" aria-selected={index === cursor}>
                <button type="button" tabIndex={-1} onMouseEnter={() => setCursor(index)} onClick={() => go(anime)}
                  className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-right transition-colors", index === cursor ? "bg-amber-400/10" : "hover:bg-white/5")}>
                  <span className="relative h-14 w-10 shrink-0 overflow-hidden rounded-lg"><CoverImage src={anime.cover ?? anime.banner ?? "/covers/placeholder.svg"} alt="" thumb sizes="40px" /></span>
                  <span className="min-w-0 flex-1"><span dir="ltr" className="block truncate text-right text-sm font-bold text-white">{anime.titleEn}</span><span className="mt-1 block truncate text-xs text-content-muted">{anime.title} · {faDigits(anime.year)}</span></span>
                  <ArrowLeft className="size-4 shrink-0 text-amber-300" />
                </button>
              </li>
            ))}
          </ul>
          <div className="shrink-0 border-t border-white/10 p-3">
            <button type="button" onClick={all} className="btn btn-glass btn-md w-full">{query.trim() ? `همهٔ نتایج برای «${query.trim()}»` : "دیدن همهٔ آرشیو"}<span className="text-xs text-content-muted">({faDigits(matches.length)})</span><ArrowLeft className="size-4" /></button>
          </div>
        </motion.div>
      </motion.div>
    ) : null}</AnimatePresence>, document.body) : null}
  </>;
}
