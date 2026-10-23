"use client";

import Link from "next/link";
import { motion, useScroll, useSpring } from "framer-motion";
import { ChevronLeft, Download, Heart, Layers3, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "@/lib/app-context";
import type { Anime } from "@/lib/data";
import { artworkFor, bannerFor } from "@/lib/images";
import { cn, faDigits, faScore } from "@/lib/utils";
import { CoverImage } from "@/components/ui/cover-image";
import { Poster } from "@/components/ui/poster";

export function AnimeDetailHero({ anime }: { anime: Anime }) {
  const { isFavorite, toggleFavorite } = useApp();
  const fav = isFavorite(anime.slug);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 28, restDelta: 0.001 });
  const [progressHost, setProgressHost] = useState<HTMLElement | null>(null);
  const banner = anime.banner || bannerFor(anime.slug);
  const art = artworkFor(anime.slug);
  const cover = anime.cover || art?.cover;
  const blur = anime.cover ? undefined : art?.blur;
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
      <section className="relative isolate -mt-[var(--header-h)] overflow-hidden">

      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden bg-ink-950">
        {cover ? (
          <div aria-hidden className="absolute inset-0 z-0 hidden overflow-hidden sm:block">
            <div
              className="absolute inset-0 scale-110 bg-cover bg-center opacity-70 blur-2xl"
              style={{ backgroundImage: `url("${cover}")` }}
            />
            <div className="absolute inset-0 bg-ink-950/25" />
          </div>
        ) : null}
        {banner ? (
          <div
            className="absolute inset-0 z-0 hidden overflow-hidden sm:block"
            style={{
              maskImage: "linear-gradient(to right, #000 0%, #000 30%, transparent 48%)",
              WebkitMaskImage: "linear-gradient(to right, #000 0%, #000 30%, transparent 48%)",
            }}
          >
            <CoverImage src={banner} blur={blur} sizes="100vw" priority zoom={false} />
          </div>
        ) : null}
        {cover ? (
          <div className={cn("absolute inset-0 z-0 overflow-hidden", banner && "sm:hidden")}>
            <CoverImage
              src={cover}
              blur={blur}
              sizes="100vw"
              priority
              position="50% 15%"
              zoom={false}
            />
          </div>
        ) : (
          <Poster anime={anime} sizes="100vw" className="absolute inset-0" priority />
        )}
        <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-l from-ink-950 via-ink-950/70 to-ink-950/10" />
        <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-ink-950 via-ink-950/15 to-ink-950/25" />
      </div>

      <div className="shell relative pb-7 pt-[calc(var(--header-h)_+_1.75rem)] sm:pb-10 sm:pt-[calc(var(--header-h)_+_2.5rem)] lg:pb-12 lg:pt-[calc(var(--header-h)_+_3rem)]">
        <nav aria-label="مسیر" className="flex items-center gap-1.5 text-[11px] text-white/50">
          <Link href="/" className="transition-colors hover:text-white">خانه</Link>
          <ChevronLeft className="size-3" />
          <Link href="/browse" className="transition-colors hover:text-white">آرشیو</Link>
          <ChevronLeft className="size-3" />
          <span className="truncate text-white/75">{anime.titleEn}</span>
        </nav>

        <div className="mt-7 grid items-end gap-8 lg:grid-cols-[1fr_272px] lg:gap-10">
          <div className="max-w-2xl">
            <h1 className="text-shadow-hero text-balance text-[clamp(1.7rem,4.4vw,3rem)] font-black leading-[1.2] text-white">
              {anime.titleEn}
            </h1>
            <p className="mt-2 text-[12.5px] font-semibold text-white/55">{anime.title}</p>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-white/80">
              <span className="inline-flex items-center gap-1.5 font-black text-gold-300">
                <Star className="size-3.5 fill-gold-400 text-gold-400" />
                {faScore(anime.score)}
              </span>
              <span>{faDigits(anime.year)}</span>
              <span className="inline-flex items-center gap-1.5">
                <Layers3 className="size-3.5 text-white/50" />
                {anime.type === "فیلم"
                  ? "فیلم"
                  : `${faDigits(anime.availableEpisodes ?? anime.episodes)} قسمت`}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className={cn("size-1.5 rounded-full", anime.status === "در حال پخش" ? "bg-success" : "bg-white/50")} />
                {anime.status}
              </span>
            </div>

            <p className="mt-4 max-w-xl text-[13px] leading-7 text-white/70">{anime.synopsis}</p>

            <div className="mt-6 flex flex-nowrap items-center gap-2 sm:flex-wrap sm:gap-2.5">
              <Link href="#episodes" className="btn btn-primary h-11 flex-1 px-5 text-xs sm:h-[52px] sm:flex-none sm:px-7 sm:text-sm">
                <Download className="size-4" />
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
                  <span className="absolute right-3 top-3 rounded-full border border-gold-300/30 bg-ink-950/70 px-2.5 py-1.5 text-[11px] font-black text-gold-300">
                    ★ {faScore(anime.score)}
                  </span>
                </Poster>
              </div>
            </div>
          </div>
        </div>
      </div>
      </section>
    </>
  );
}
