"use client";

import Link from "next/link";
import { ArrowLeft, Clapperboard, Globe2, Play, Star } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Anime } from "@/lib/catalog";
import { useCatalog } from "@/lib/admin-store";
import { cn, faDigits, faScore } from "@/lib/utils";
import { AnimeCard } from "@/components/anime-card";
import { CoverImage } from "@/components/ui/cover-image";
import { Poster } from "@/components/ui/poster";
import { Rail } from "@/components/ui/rail";

function ShelfHeading({
  icon,
  title,
  href,
  linkLabel,
}: {
  icon: ReactNode;
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-amber-400/20 bg-amber-400/[0.08] text-amber-300">
          {icon}
        </span>
        <h2 className="headline text-lg sm:text-xl">{title}</h2>
      </div>
      <Link
        href={href}
        className="group inline-flex shrink-0 items-center gap-1.5 text-[12px] font-bold text-amber-300 transition-colors hover:text-white"
      >
        {linkLabel}
        <ArrowLeft className="size-3.5 transition-transform duration-300 group-hover:-translate-x-1" />
      </Link>
    </div>
  );
}

function CinemaCard({ anime, active = false }: { anime: Anime; active?: boolean }) {
  // The generated banner is already a blurred backdrop with the poster baked
  // in, so blurring it again made the card background unreadable. Use the
  // sharp portrait cover for the backdrop and keep it only slightly softened.
  const backdrop = anime.cover || anime.banner;
  const poster = anime.cover || anime.banner;

  return (
    <article
      className={cn(
        "group/cinema relative w-[78vw] shrink-0 snap-center sm:snap-start transition-transform duration-500 ease-spring sm:w-[360px] lg:w-[400px]",
        // The card resting at the edge lifts so it reads as the one in focus.
        active ? "-translate-y-2 scale-[1.02]" : "hover:-translate-y-1.5",
      )}
    >
      {/* The two soft layers follow the card when it lifts and fade on hover. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-8 -top-2 h-9 rounded-[50%] bg-amber-400/10 blur-2xl opacity-60 transition-all duration-500 group-hover/cinema:-translate-y-1.5 group-hover/cinema:opacity-90"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 -bottom-3 h-8 rounded-[50%] bg-black/60 blur-xl opacity-70 transition-all duration-500 group-hover/cinema:-translate-y-1.5 group-hover/cinema:opacity-95"
      />

      <Link
        href={`/anime/${anime.slug}`}
        className={cn(
          "glass-card relative block overflow-hidden rounded-3xl border border-white/[0.1] transition-[border-color,box-shadow] duration-500 group-hover/cinema:border-amber-400/40 group-hover/cinema:shadow-lift",
          active && "border-amber-400/40 shadow-lift",
        )}
      >
        <div className="relative aspect-[16/10] overflow-hidden bg-ink-900">
          {backdrop ? (
            <CoverImage
              src={backdrop}
              sizes="(max-width: 640px) 78vw, 400px"
              position="50% 28%"
              className="absolute inset-0 scale-100 blur-[2px] opacity-90 saturate-110"
            />
          ) : (
            <Poster
              anime={anime}
              sizes="(max-width: 640px) 78vw, 400px"
              className="absolute inset-0 scale-100 blur-[2px] opacity-90"
            />
          )}
          <div aria-hidden className="absolute inset-0 bg-[#050507]/15" />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#050507]/90 via-[#050507]/15 to-transparent" />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-l from-transparent via-transparent to-[#050507]/10" />

          {/* Sharp cover in the corner: brighter than the blurred backdrop. */}
          {poster ? (
            <div
              className="absolute right-4 top-4 z-20 w-[68px] -translate-y-1 overflow-hidden rounded-sm border border-white/25 bg-ink-900 shadow-[0_12px_28px_rgba(0,0,0,.55)] sm:w-[84px]"
              style={{ filter: "brightness(1.12) saturate(1.05)" }}
            >
              <div className="aspect-[17/24]">
                <Poster anime={anime} sizes="84px" thumb position="50% 18%" className="absolute inset-0" />
              </div>
            </div>
          ) : null}

          <span className="absolute left-3 top-3 z-20 inline-flex items-center gap-1 rounded-full border border-white/15 bg-ink-950/70 px-2 py-1 text-[10.5px] font-black text-amber-300 backdrop-blur-md">
            <Star className="size-2.5 fill-amber-400 text-amber-400" />
            {faScore(anime.score)}
          </span>

          <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-4">
            <div className="min-w-0 pe-2">
              <p className="text-[10px] font-bold text-amber-300">سینمایی</p>
              <h3
                dir="ltr"
                className="mt-1 line-clamp-1 text-right text-[15px] font-black leading-6 text-white"
              >
                {anime.titleEn}
              </h3>
              <p className="mt-0.5 truncate text-[10.5px] text-white/55">
                {faDigits(anime.year)}
              </p>
            </div>
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-400 text-ink-950 shadow-[0_10px_28px_-8px_rgba(255,214,10,.7)] transition-transform duration-300 group-hover/cinema:scale-110">
              <Play className="ms-0.5 size-4 fill-current" />
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

export function MoviesShelf({ items }: { items: Anime[] }) {
  const movies = useCatalog(items);
  const [active, setActive] = useState(0);
  if (!movies.length) return null;

  return (
    <section className="shell section-pad">
      <ShelfHeading
        icon={<Clapperboard className="size-4" />}
        title="سینمایی‌ها"
        href="/browse?type=%D9%81%DB%8C%D9%84%D9%85"
        linkLabel="بیشتر"
      />
      <Rail
        ariaLabel="سینمایی‌ها"
        stepping
        centered
        onActiveChange={setActive}
        innerClassName="overflow-y-hidden pt-6 pb-7"
      >
        {movies.map((anime, index) => (
          <CinemaCard key={anime.slug} anime={anime} active={index === active} />
        ))}
      </Rail>
    </section>
  );
}

export function ChineseShelf({ items }: { items: Anime[] }) {
  const chinese = useCatalog(items);
  if (!chinese.length) return null;

  return (
    <section className="shell section-pad">
      <ShelfHeading
        icon={<Globe2 className="size-4" />}
        title="انیمه‌های چینی"
        href="/browse?collection=chinese"
        linkLabel="بیشتر"
      />
      <Rail ariaLabel="انیمه‌های چینی">
        {chinese.map((anime, index) => (
          <AnimeCard key={anime.slug} anime={anime} index={index} />
        ))}
      </Rail>
    </section>
  );
}
