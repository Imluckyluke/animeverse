"use client";

import Link from "next/link";
import { motion, useScroll, useSpring } from "framer-motion";
import { ChevronLeft, Download, Heart, Layers3, Star } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "@/lib/app-context";
import type { Anime } from "@/lib/catalog";
import { cn, faDigits, faScore } from "@/lib/utils";
import { HeroArtwork } from "@/components/ui/hero-artwork";
import { Poster } from "@/components/ui/poster";
import { ExpandableSynopsis } from "@/components/anime/expandable-synopsis";
import { LibraryControl } from "@/components/library-control";
import { getEpisodeAvailability, getLatestEpisode, getScoreLabel, hasReportedScore } from "@/lib/catalog-metadata";

export function AnimeDetailHero({ anime, latestEpisodeDateLabel = "", nextEpisodeLabel = "" }: { anime: Anime; latestEpisodeDateLabel?: string; nextEpisodeLabel?: string }) {
  const { isFavorite, toggleFavorite } = useApp();
  const fav = isFavorite(anime.slug);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 28, restDelta: 0.001 });
  const [progressHost, setProgressHost] = useState<HTMLElement | null>(null);
  const hero = useRef<HTMLElement>(null);
  const story = useRef({ open: false, extra: 0, base: 0 });
  const syncStoryArtwork = useCallback(() => {
    const node = hero.current;
    if (!node) return;
    const state = story.current;
    state.base = Math.max(1, node.offsetHeight - (state.open ? state.extra : 0));
    node.style.setProperty("--detail-art-height", `${state.base}px`);
    node.style.setProperty("--detail-art-scale", String(state.open ? 1 + state.extra / state.base : 1));
  }, []);
  const storyLayout = useCallback(({ full, collapsed }: { full: number; collapsed: number }) => {
    story.current.extra = Math.max(0, full - collapsed);
    syncStoryArtwork();
  }, [syncStoryArtwork]);
  const storyOpen = useCallback((open: boolean) => {
    story.current.open = open;
    const { extra, base } = story.current;
    hero.current?.style.setProperty("--detail-art-scale", String(open && base ? 1 + extra / base : 1));
  }, []);
  useEffect(() => {
    const node = hero.current;
    if (!node) return;
    let width = 0;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      syncStoryArtwork();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [anime.slug, syncStoryArtwork]);
  const availability = getEpisodeAvailability(anime);
  const latestEpisode = anime.type !== "فیلم" ? getLatestEpisode(anime) : null;
  const reportedScore = hasReportedScore(anime);
  const nextEpisodeAt = anime.nextEpisodeAt && Number.isFinite(Date.parse(anime.nextEpisodeAt)) ? anime.nextEpisodeAt : null;
  useEffect(() => {
    setProgressHost(document.body);
  }, []);

  return (
    <>
      {progressHost
        ? createPortal(
            <motion.div
              aria-hidden
              data-scroll-progress
              className="pointer-events-none fixed inset-x-0 top-0 z-[88] h-[2px] origin-right bg-amber-400"
              style={{ scaleX: progress }}
            />,
            progressHost,
          )
        : null}
      <section ref={hero} className="anime-detail-hero relative isolate -mt-[var(--header-h)] overflow-hidden">

      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden bg-ink-950">
        <div className="detail-art-layer">
        <HeroArtwork anime={anime} priority />
        </div>
        <div className="detail-fade pointer-events-none absolute inset-0 z-10 bg-gradient-to-l from-ink-950 via-ink-950/70 to-ink-950/10" />
        <div className="detail-fade pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-ink-950 via-ink-950/15 to-ink-950/25" />
      </div>

      <div className="shell relative pb-7 pt-[calc(var(--header-h)_+_1.75rem)] sm:pb-10 sm:pt-[calc(var(--header-h)_+_2.5rem)] lg:pb-12 lg:pt-[calc(var(--header-h)_+_3rem)]">
        <nav aria-label="مسیر" className="-my-2 flex items-center gap-0.5 text-[11px] text-white/50">
          <Link href="/" className="inline-flex min-h-10 items-center px-1.5 py-2 transition-colors hover:text-white focus-visible:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/45">خانه</Link>
          <ChevronLeft aria-hidden className="size-3.5 shrink-0 text-white/30" />
          <Link href="/browse" className="inline-flex min-h-10 items-center px-1.5 py-2 transition-colors hover:text-white focus-visible:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/45">آرشیو</Link>
          <ChevronLeft aria-hidden className="size-3.5 shrink-0 text-white/30" />
          <span aria-current="page" className="inline-flex min-h-10 min-w-0 items-center truncate px-1.5 py-2 text-white/75">{anime.titleEn}</span>
        </nav>

        <div className="mt-7 grid items-end gap-8 lg:grid-cols-[1fr_272px] lg:gap-10">
          <div className="max-w-2xl">
            <h1 dir="ltr" className="text-shadow-hero text-balance text-right text-[clamp(1.7rem,4.4vw,3rem)] font-black leading-[1.2] text-white">
              {anime.titleEn}
            </h1>
            <p className="mt-2 text-[12.5px] font-semibold text-white/55">{anime.title}</p>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] tabular-nums text-white/80">
              {reportedScore ? <span title={getScoreLabel(anime)} className="inline-flex items-center gap-1.5 font-black text-gold-300">
                <Star className="size-3.5 fill-gold-400 text-gold-400" />
                {faScore(anime.score)}
              </span> : <span className="text-white/45">امتیاز اعلام نشده</span>}
              {anime.year > 0 ? <span>{faDigits(anime.year)}</span> : null}
              <span className="inline-flex items-center gap-1.5">
                <Layers3 className="size-3.5 text-white/50" />
                {anime.type === "فیلم"
                  ? "فیلم"
                  : latestEpisode
                    ? `آخرین قسمت ${faDigits(latestEpisode.number)}${latestEpisodeDateLabel ? ` · ${latestEpisodeDateLabel}` : ""}`
                    : availability.indexedCount > 0
                      ? `آخرین قسمت ${faDigits(availability.indexedCount)}`
                      : "قسمت‌ها به‌زودی"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className={cn("size-1.5 rounded-full", anime.status === "در حال پخش" ? "bg-success" : "bg-white/50")} />
                {anime.status}
              </span>
            </div>

            <ExpandableSynopsis text={anime.synopsis} onLayout={storyLayout} onOpenChange={storyOpen} />

            <div className="mt-6 flex flex-nowrap items-center gap-2 sm:flex-wrap sm:gap-2.5">
              <Link href="#episodes" className="btn btn-primary h-11 flex-1 px-5 text-xs sm:h-[52px] sm:flex-none sm:px-7 sm:text-sm">
                <Download aria-hidden className="size-4" />
                دانلود
              </Link>
              <button
                type="button"
                onClick={() => toggleFavorite(anime.slug)}
                aria-pressed={fav}
                aria-label={fav ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"}
                className={cn("icon-btn size-11 shrink-0 sm:size-[52px]", fav && "border-rose-400/40 bg-rose-500/15 text-rose-400")}
              >
                <Heart className={cn("size-5", fav && "fill-rose-400")} />
              </button>
            </div>
            <LibraryControl slug={anime.slug} className="mt-3 w-full sm:w-auto sm:min-w-52" />

            <div className="mt-5 flex flex-wrap items-center gap-1.5">
              {anime.genres.slice(0, 3).map((g) => (
                <Link
                  key={g}
                  href={`/browse?genre=${encodeURIComponent(g)}`}
                  className="rounded-full border border-white/[0.14] bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-white/80 transition-colors hover:border-amber-400/40 hover:text-white"
                >
                  {g}
                </Link>
              ))}
            </div>
          </div>

          <div className="relative order-first flex justify-center lg:order-last">
            <div className="relative w-[164px] sm:w-[200px] lg:w-[272px]">
              <div className="rounded-3xl border border-white/[0.14] bg-[#16161e] p-2 shadow-poster">
                <Poster
                  anime={anime}
                  sizes="(max-width: 640px) 164px, (max-width: 1024px) 200px, 272px"
                  priority
                  position="50% 18%"
                  className="aspect-[17/24] rounded-2xl"
                >
                  {reportedScore ? <span title={getScoreLabel(anime)} className="absolute right-3 top-3 rounded-full border border-gold-300/30 bg-ink-950/70 px-2.5 py-1.5 text-[11px] font-black text-gold-300">
                    ★ {faScore(anime.score)}
                  </span> : null}
                  {latestEpisode ? <span data-latest-episode className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-2 pb-3 pt-10 text-center text-xs leading-5 text-white">
                    <span className="block text-white/70">آخرین اپیزود</span>
                    <span className="block font-bold">قسمت {faDigits(latestEpisode.number)}</span>
                    {latestEpisode.releasedAt && latestEpisodeDateLabel ? <time dateTime={latestEpisode.releasedAt} className="mt-0.5 block text-[10px] text-white/65">{latestEpisodeDateLabel}</time> : null}
                  </span> : null}
                </Poster>
              </div>
              <div className="mt-3 space-y-1 text-center text-xs leading-6 text-content-muted">
                {anime.status === "در حال پخش" ? <p>قسمت بعد: {nextEpisodeAt && nextEpisodeLabel ? <time dateTime={nextEpisodeAt} className="text-amber-200">{nextEpisodeLabel}</time> : "زمان انتشار هنوز اعلام نشده"}</p> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      </section>
    </>
  );
}
