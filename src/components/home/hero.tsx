"use client";

import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { Download, Heart, Star } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type TouchEvent } from "react";
import { useApp } from "@/lib/app-context";
import type { HeroAnime } from "@/lib/catalog";
import { artworkFor } from "@/lib/images";
import { useAdminState, useCatalog } from "@/lib/admin-store";
import { cn, faDigits, faNum, faScore } from "@/lib/utils";
import { CoverImage } from "@/components/ui/cover-image";
import { Poster } from "@/components/ui/poster";

const SLIDE_MS = 7000;

/** Full-bleed cover art + a single glass card (Apple "hero" pattern). */
export function Hero({ items }: { items: HeroAnime[] }) {
  const reduce = useReducedMotion();
  const pool = useCatalog(items).slice(0, 5);
  const admin = useAdminState();
  const pinnedKey = admin.pinned.join("|");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const { isFavorite, toggleFavorite } = useApp();
  const total = Math.max(pool.length, 1);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swallowClick = useRef(false);

  // The admin star pins an entry to the front. Jump to it immediately so the
  // change is visible without waiting for the daily home-page cache.
  useEffect(() => {
    if (pinnedKey) setIndex(0);
  }, [pinnedKey]);

  // A timeout (not an interval) keyed to the current slide: every move — auto
  // or a swipe/tap by the reader — restarts the full wait, so a slide never
  // changes right after the reader just changed it themselves.
  useEffect(() => {
    if (reduce || paused || total < 2) return;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % total), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [reduce, paused, total, index]);

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
    go(dx < 0 ? 1 : -1);
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
    >
      {pool.map((item, i) => {
        const art = artworkFor(item.slug);
        const cover = item.cover || art?.cover;
        const banner = item.banner || art?.banner;
        const blur = item.cover ? undefined : art?.blur;

        return (
          <div
            key={item.slug}
            aria-hidden={i !== index}
            className={cn(
              "absolute inset-0 -z-10 transition-opacity ease-out will-change-opacity",
              i === index ? "opacity-100" : "opacity-0",
            )}
            style={{ transitionDuration: reduce ? "0ms" : "800ms" }}
          >
            {cover ? (
              <div aria-hidden className="absolute inset-0 hidden overflow-hidden lg:block">
                <div
                  className="absolute inset-0 scale-110 bg-cover bg-center opacity-70 blur-2xl"
                  style={{ backgroundImage: `url("${cover}")` }}
                />
                <div className="absolute inset-0 bg-ink-950/25" />
              </div>
            ) : null}
            {banner ? (
              <div
                className="absolute inset-0 hidden lg:block"
                style={{
                  maskImage: "linear-gradient(to right, #000 0%, #000 26%, transparent 46%)",
                  WebkitMaskImage: "linear-gradient(to right, #000 0%, #000 26%, transparent 46%)",
                }}
              >
                <CoverImage
                  src={banner}
                  blur={blur}
                  sizes="100vw"
                  priority={i === 0}
                  position="50% 50%"
                  zoom={false}
                />
              </div>
            ) : null}
            {cover ? (
              <div className={cn("absolute inset-0", banner && "lg:hidden")}>
                <CoverImage
                  src={cover}
                  blur={blur}
                  sizes="100vw"
                  priority={i === 0}
                  position="50% 30%"
                  zoom={false}
                />
              </div>
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
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[76%] bg-gradient-to-t from-ink-950/90 via-ink-950/35 to-transparent lg:hidden"
      />

      <button
        type="button"
        aria-label="اسلاید بعدی"
        tabIndex={-1}
        onClick={() => go(1)}
        disabled={total < 2}
        className="absolute inset-y-0 left-0 z-0 hidden w-1/2 cursor-pointer lg:block"
      />
      <button
        type="button"
        aria-label="اسلاید قبلی"
        tabIndex={-1}
        onClick={() => go(-1)}
        disabled={total < 2}
        className="absolute inset-y-0 right-0 z-0 hidden w-1/2 cursor-pointer lg:block"
      />

      <div className="shell pointer-events-none relative flex min-h-[calc(84svh_+_var(--header-h))] items-end pb-6 pt-14 sm:min-h-[calc(88svh_+_var(--header-h))] sm:pb-14 sm:pt-16 md:pb-16 lg:min-h-[calc(92svh_+_var(--header-h))]">
        <div className="pointer-events-auto w-full max-w-[620px] rounded-3xl border border-white/[0.12] bg-[rgba(9,9,15,.32)] p-4 shadow-lift backdrop-blur-[6px] backdrop-saturate-150 [text-shadow:0_1px_16px_rgba(0,0,0,0.5)] sm:p-5 lg:bg-[rgba(10,10,16,.32)] lg:p-6 xl:p-7">
          <div className="grid">
            {pool.map((slide, slideIndex) => {
              const active = slideIndex === index;
              const fav = isFavorite(slide.slug);
              const TitleTag = active ? "h1" : "div";

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

                  <TitleTag className="mt-3 line-clamp-3 text-balance text-[1.55rem] font-black leading-[1.15] tracking-[-0.022em] text-white lg:mt-4 lg:text-[clamp(1.9rem,4.6vw,3.4rem)] lg:leading-[1.18]">
                    {slide.titleEn}
                  </TitleTag>
                  <p className="mt-1.5 text-[11.5px] font-semibold text-white/60 lg:mt-2 lg:text-[12.5px]">{slide.title}</p>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-white/80 lg:mt-3.5 lg:gap-x-4 lg:gap-y-2 lg:text-[12.5px]">
                    <span className="inline-flex items-center gap-1.5 font-black text-white">
                      <Star className="size-3.5 fill-amber-400 text-amber-400" />
                      {faScore(slide.score)}
                    </span>
                    <span>{faDigits(slide.year)}</span>
                    <span>
                      {slide.type === "فیلم"
                        ? "فیلم"
                        : `${faDigits(slide.availableEpisodes ?? slide.episodes)} قسمت`}
                    </span>
                  </div>

                  <p className="mt-2 line-clamp-2 max-w-[54ch] text-pretty text-[11.5px] leading-5 text-white/75 lg:mt-3 lg:line-clamp-3 lg:text-[13.5px] lg:leading-7 lg:text-white/80">
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
                        fav && "border-amber-400/45 text-amber-300",
                      )}
                    >
                      <Heart className={cn("size-4", fav && "fill-amber-400 text-amber-400")} />
                      <span className="hidden lg:inline">{fav ? "در لیست من ✓" : "افزودن به لیست من"}</span>
                    </button>
                  </div>

                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-center gap-0.5 lg:mt-6">
            {pool.map((item, i) => (
              <button
                key={item.slug}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`رفتن به اسلاید ${faNum(i + 1)}`}
                aria-current={i === index}
                className="grid h-6 min-w-8 place-items-center"
              >
                <span
                  className={cn(
                    "h-[5px] rounded-full transition-all duration-300",
                    i === index ? "w-[34px] bg-amber-400" : "w-[26px] bg-white/30 hover:bg-white/50",
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
