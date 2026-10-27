"use client";

import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { Download, Heart, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type TouchEvent, type PointerEvent } from "react";
import { useApp } from "@/lib/app-context";
import type { HeroAnime } from "@/lib/catalog";
import { artworkFor } from "@/lib/images";
import { applyAdmin, useAdminState } from "@/lib/admin-store";
import { cn, faDigits, faNum, faScore } from "@/lib/utils";
import { HeroArtwork } from "@/components/ui/hero-artwork";
import { Poster } from "@/components/ui/poster";
import { getLatestEpisode, getScoreLabel, hasReportedScore } from "@/lib/catalog-metadata";

const SLIDE_MS = 4500;
// Survives client-side navigation: coming home lands on the slide the reader
// left, and the autoplay wait starts fresh from that return.
let rememberedIndex = 0;
let rememberedFeatures: HeroAnime[] = [];
const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

/** Full-bleed cover art + a single glass card (Apple "hero" pattern). */
export function Hero({ items }: { items: HeroAnime[] }) {
  const reduce = useReducedMotion();
  const admin = useAdminState();
  const hydrated = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
  const pinnedKey = admin.pinned.join("|");
  const [extraFeatures, setExtraFeatures] = useState<HeroAnime[]>(rememberedFeatures);
  const candidates = useMemo(() => [...items, ...extraFeatures.filter(extra => !items.some(item => item.slug === extra.slug))], [items, extraFeatures]);
  const pool = useMemo(() => applyAdmin(candidates, admin).slice(0, 5), [candidates, admin]);
  const previousPinnedKey = useRef(pinnedKey);
  const [settledPinnedKey, setSettledPinnedKey] = useState<string | null>(null);
  const awaitingPinned = admin.pinned.some(slug => !candidates.some(item => item.slug === slug));
  const ready = hydrated && (!awaitingPinned || settledPinnedKey === pinnedKey);
  const [index, setIndex] = useState(rememberedIndex);
  const [paused, setPaused] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const overlayIds = useRef(new Set<string>());
  const { isFavorite, toggleFavorite } = useApp();
  const total = Math.max(pool.length, 1);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const mouseStart = useRef<{ x: number; y: number; id: number } | null>(null);

  useEffect(() => {
    const missing = pinnedKey.split("|").filter(slug => slug && !items.some(item => item.slug === slug)).slice(0, 5);
    if (!missing.length) { setExtraFeatures([]); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSettledPinnedKey(pinnedKey);
      controller.abort();
    }, 8000);
    fetch(`/api/catalog-items?${new URLSearchParams({ slugs: missing.join(",") })}`, { signal: controller.signal })
      .then(async response => {
        if (response.ok) {
          const data = await response.json() as HeroAnime[];
          if (!controller.signal.aborted) {
            rememberedFeatures = data;
            setExtraFeatures(data);
          }
        }
      }).catch(() => { /* Keep the normal daily features available offline. */ })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!controller.signal.aborted) setSettledPinnedKey(pinnedKey);
      });
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [pinnedKey, items]);

  // The admin star pins an entry to the front. Jump to it immediately so the
  // change is visible without waiting for the daily home-page cache.
  useEffect(() => {
    if (previousPinnedKey.current !== pinnedKey && pinnedKey) setIndex(0);
    previousPinnedKey.current = pinnedKey;
  }, [pinnedKey]);

  // A timeout (not an interval) keyed to the current slide: every move — auto
  // or a swipe/tap by the reader — restarts the full wait, so a slide never
  // changes right after the reader just changed it themselves.
  useEffect(() => {
    if (!ready || reduce || paused || searchOpen || total < 2) return;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % total), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [ready, reduce, paused, searchOpen, total, index]);

  useEffect(() => {
    const opened = (event: Event) => {
      overlayIds.current.add((event as CustomEvent<string>).detail);
      setSearchOpen(true);
    };
    const closed = (event: Event) => {
      if (!overlayIds.current.delete((event as CustomEvent<string>).detail)) return;
      setSearchOpen(overlayIds.current.size > 0);
    };
    window.addEventListener("av-search-open", opened);
    window.addEventListener("av-search-close", closed);
    window.addEventListener("av-downloads-open", opened);
    window.addEventListener("av-downloads-close", closed);
    return () => {
      window.removeEventListener("av-search-open", opened);
      window.removeEventListener("av-search-close", closed);
      window.removeEventListener("av-downloads-open", opened);
      window.removeEventListener("av-downloads-close", closed);
    };
  }, []);

  useEffect(() => {
    rememberedIndex = index;
  }, [index]);

  useEffect(() => {
    if (index >= total) setIndex(0);
  }, [index, total]);

  const go = (dir: 1 | -1) => setIndex((i) => (i + dir + total) % total);

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
    // Hold the auto-advance while a finger is down, then restart it on release.
    setPaused(true);
  };

  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    setPaused(false);
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
    swallowClick.current = true;
    // RTL: dragging right reveals the next slide from the left.
    go(dx > 0 ? 1 : -1);
    window.setTimeout(() => {
      swallowClick.current = false;
    }, 450);
  };

  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!swallowClick.current) return;
    event.preventDefault();
    event.stopPropagation();
    swallowClick.current = false;
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const control = (event.target as HTMLElement).closest("button,a,input");
    if (control && !control.hasAttribute("data-hero-nav")) return;
    mouseStart.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    setPaused(true);
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = mouseStart.current;
    mouseStart.current = null;
    if (!start) return;
    setPaused(false);
    if (event.currentTarget.hasPointerCapture(start.id)) event.currentTarget.releasePointerCapture(start.id);
    if (event.type === "pointercancel") return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(event.clientY - start.y)) {
      go(dx > 0 ? 1 : -1);
      swallowClick.current = true;
    }
  };

  // The server cannot know browser-local pins. Reserve the hero geometry with
  // a neutral glass preview rather than paint a wrong title/artwork and swap it
  // during hydration. Client navigation already has a ready snapshot.
  if (!ready) return (
    <section data-hero-loading aria-busy="true" aria-label="در حال آماده‌سازی پیشنهادها" className="relative isolate -mt-[var(--header-h)] overflow-hidden bg-ink-950">
      <div className="shell relative flex min-h-[min(680px,76svh)] items-end pb-6 pt-[calc(var(--header-h)_+_2rem)] sm:min-h-[min(720px,78svh)] sm:pb-10 lg:min-h-[min(740px,80svh)]">
        <div aria-hidden className="w-full max-w-[620px] rounded-3xl border border-white/[0.12] bg-white/[0.025] p-4 sm:p-5 lg:p-6 xl:p-7">
          <div className="flex justify-end gap-2"><div className="skeleton h-5 w-20" /><div className="skeleton h-5 w-24" /></div>
          <div className="skeleton mt-5 h-9 w-3/4" />
          <div className="skeleton mt-4 h-4 w-1/2" />
          <div className="skeleton mt-5 h-4 w-2/3" />
          <div className="skeleton mt-20 h-11 w-full lg:mt-48" />
          <div className="mx-auto mt-6 h-[5px] w-32 rounded-full bg-white/10" />
        </div>
      </div>
    </section>
  );

  return (
    <section
      className="relative isolate -mt-[var(--header-h)] overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onClickCapture={onClickCapture}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => {
        const start = mouseStart.current;
        if (start && Math.abs(event.clientX - start.x) > 6) {
          event.currentTarget.setPointerCapture(start.id);
          event.preventDefault();
        }
      }}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragStart={(event) => event.preventDefault()}
    >
      {pool.map((item, i) => {
        const art = artworkFor(item.slug);
        const cover = item.cover || art?.cover;
        const image = cover || item.banner || art?.banner;

        return (
          <div
            key={item.slug}
            aria-hidden={i !== index}
            className={cn(
              "absolute inset-0 -z-10 transition-opacity ease-out",
              i === index ? "opacity-100" : "opacity-0",
            )}
            style={{ transitionDuration: reduce ? "0ms" : "450ms" }}
          >
            {image ? (
              <HeroArtwork anime={item} priority={i === 0} />
            ) : (
              <Poster
                anime={item}
                sizes="100vw"
                className="absolute inset-0"
                priority={i === 0}
              />
            )}
          </div>
        );
      })}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[rgba(4,4,8,.14)] lg:bg-[rgba(4,4,8,.2)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-ink-950 via-ink-950/20 to-ink-950/25 lg:via-ink-950/35 lg:to-ink-950/45"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[76%] bg-gradient-to-t from-ink-950 via-ink-950/35 to-transparent lg:hidden"
      />

      <button
        type="button"
        aria-label="اسلاید بعدی"
        data-hero-nav
        tabIndex={-1}
        onClick={() => go(1)}
        disabled={total < 2}
        className="absolute inset-y-0 left-0 z-0 hidden w-1/2 cursor-pointer lg:block"
      />
      <button
        type="button"
        aria-label="اسلاید قبلی"
        data-hero-nav
        tabIndex={-1}
        onClick={() => go(-1)}
        disabled={total < 2}
        className="absolute inset-y-0 right-0 z-0 hidden w-1/2 cursor-pointer lg:block"
      />

      <div className="shell pointer-events-none relative flex min-h-[min(680px,76svh)] items-end pb-6 pt-[calc(var(--header-h)_+_2rem)] sm:min-h-[min(720px,78svh)] sm:pb-10 lg:min-h-[min(740px,80svh)]">
        <div className="hero-info pointer-events-auto w-full max-w-[620px] rounded-3xl border border-white/[0.12] bg-[rgba(9,9,15,.32)] p-3 shadow-lift backdrop-blur-[6px] backdrop-saturate-150 [text-shadow:0_1px_16px_rgba(0,0,0,0.5)] sm:p-5 lg:bg-[rgba(10,10,16,.32)] lg:p-6 xl:p-7">
          <div className="grid">
            {pool.map((slide, slideIndex) => {
              const active = slideIndex === index;
              const fav = isFavorite(slide.slug);
              const TitleTag = active ? "h1" : "div";
              const latestEpisode = getLatestEpisode(slide);

              return (
                <div
                  key={slide.slug}
                  aria-hidden={!active}
                  className={cn(
                    "hero-slide col-start-1 row-start-1 flex flex-col",
                    active ? "is-active relative z-10" : "pointer-events-none",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold lg:px-3 lg:py-1 lg:text-[11px]",
                        slide.status === "در حال پخش"
                          ? "border-success/45 bg-success/10 text-success"
                          : "border-amber-400/45 bg-transparent text-amber-300",
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", slide.status === "در حال پخش" ? "bg-success" : "bg-white/45")} />
                      {slide.status}
                    </span>
                    <span className="rounded-full border border-white/[0.12] bg-white/[0.08] px-2.5 py-0.5 text-[10.5px] font-semibold text-white/80 lg:px-3 lg:py-1 lg:text-[11px]">
                      زیرنویس فارسی
                    </span>
                  </div>

                  <TitleTag dir="ltr" className="mt-2 line-clamp-2 text-balance text-right text-[1.375rem] font-black leading-[1.15] tracking-[-0.022em] text-white sm:mt-3 sm:line-clamp-3 sm:text-[1.55rem] lg:mt-4 lg:text-[clamp(1.9rem,4.6vw,3.4rem)] lg:leading-[1.18]">
                    {slide.titleEn}
                  </TitleTag>
                  <p className="mt-1 line-clamp-1 text-xs font-semibold text-white/70 sm:mt-1.5 sm:line-clamp-none sm:text-[13px] lg:mt-2">{slide.title}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-white/80 sm:mt-2.5 lg:mt-3.5 lg:gap-x-4 lg:gap-y-2 lg:text-[12.5px]">
                    {hasReportedScore(slide) ? <span title={getScoreLabel(slide)} className="inline-flex items-center gap-1.5 font-black text-white">
                      <Star className="size-3.5 fill-amber-400 text-amber-400" />
                      {faScore(slide.score)}
                    </span> : null}
                    {slide.year > 0 ? <span>{faDigits(slide.year)}</span> : null}
                    {slide.type === "فیلم" ? <span>فیلم</span> : latestEpisode ? <span>آخرین قسمت {faDigits(latestEpisode.number)}</span> : null}
                  </div>

                  <p className="mt-1.5 line-clamp-1 max-w-[54ch] text-pretty text-xs leading-5 text-white/75 sm:mt-2 sm:line-clamp-2 sm:text-[13px] sm:leading-6 lg:mt-3 lg:line-clamp-3 lg:text-[13.5px] lg:leading-7 lg:text-white/80">
                    {slide.synopsis}
                  </p>

                  <div className="mt-auto flex items-center gap-2 pt-3.5 lg:gap-3 lg:pt-6">
                    <Link
                      href={`/anime/${slide.slug}`}
                      tabIndex={active ? 0 : -1}
                      className="btn btn-primary h-11 w-full flex-1 px-4 text-xs lg:h-[52px] lg:w-auto lg:px-7 lg:text-sm"
                    >
                      <Download className="size-4" />
                      مشاهده و دانلود
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(slide.slug)}
                      tabIndex={active ? 0 : -1}
                      aria-pressed={fav}
                      aria-label={fav ? "حذف از لیست من" : "افزودن به لیست من"}
                      className={cn(
                        "btn btn-glass h-11 w-11 shrink-0 bg-ink-950/55 px-0 backdrop-blur-none [backdrop-filter:none] lg:h-[52px] lg:w-auto lg:px-7 lg:text-sm",
                        fav && "border-rose-400/45 text-rose-300",
                      )}
                    >
                      <Heart className={cn("size-4", fav && "fill-rose-400 text-rose-400")} />
                      <span className="hidden lg:inline">{fav ? "در لیست من ✓" : "افزودن به لیست من"}</span>
                    </button>
                  </div>

                </div>
              );
            })}
          </div>

          <div className="hero-pagination mt-2 flex items-center justify-center gap-0.5 sm:mt-4 lg:mt-6">
            {pool.map((item, i) => (
              <button
                key={item.slug}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`رفتن به اسلاید ${faNum(i + 1)}`}
                aria-current={i === index}
                className="relative grid h-6 min-w-8 place-items-center rounded-full before:absolute before:-inset-x-0.5 before:-inset-y-2.5 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/50"
              >
                <span
                  className={cn(
                    "h-[5px] rounded-full transition-all duration-300",
                    i === index ? "w-[26px] bg-amber-400 shadow-[0_0_12px_rgba(240,180,92,.5)]" : "w-[20px] bg-white/30 hover:bg-white/50",
                  )}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
