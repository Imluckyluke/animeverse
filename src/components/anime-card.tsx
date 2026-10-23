"use client";

import Link from "next/link";
import { Heart, Star } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { splitQualities, type Anime } from "@/lib/catalog";
import { cn, faDigits, faScore } from "@/lib/utils";
import { Poster } from "@/components/ui/poster";

/**
 * One decision per card: picture, title, two facts. Nothing else.
 */
export function AnimeCard({
  anime,
  className,
  fluid = false,
}: {
  anime: Anime;
  className?: string;
  /** Kept for the existing call sites; cards intentionally render without an entrance delay. */
  index?: number;
  fluid?: boolean;
}) {
  const { isFavorite, toggleFavorite } = useApp();
  const fav = isFavorite(anime.slug);
  const qualities = splitQualities(anime.quality);
  const qualityLabel = qualities.base.length
    ? [qualities.base[0], qualities.x265 ? "x265" : null].filter(Boolean).join(" · ")
    : qualities.all[0] ?? "HD";

  return (
    <article
      className={cn(
        "group/card relative snap-start",
        fluid ? "w-full" : "w-[40vw] shrink-0 sm:w-[188px] lg:w-[200px]",
        className,
      )}
    >
      <div className="glass-card relative overflow-hidden rounded-3xl transition-[transform,border-color,box-shadow] duration-300 ease-spring group-hover/card:-translate-y-1.5 group-hover/card:border-amber-400/45 group-hover/card:shadow-lift">
        <Link
          href={`/anime/${anime.slug}`}
          className="block"
          aria-label={`${anime.titleEn} — ${faDigits(anime.year)}`}
        >
          <div className="relative aspect-[17/24] overflow-hidden">
            <Poster
              anime={anime}
              sizes="(max-width: 640px) 40vw, 200px"
              thumb
              position="50% 18%"
              className="absolute inset-0 transition-transform duration-700 ease-snap group-hover/card:scale-[1.05]"
            >
              <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full border border-gold-300/25 bg-ink-950/70 px-2 py-1 text-[11px] font-black text-gold-300">
                <Star className="size-2.5 fill-gold-400 text-gold-400" />
                {faScore(anime.score)}
              </span>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-ink-950/85 via-ink-950/30 to-transparent"
              />
              <span
                dir="ltr"
                className="absolute bottom-2.5 left-2.5 z-10 rounded-md border border-white/[0.14] bg-ink-950/80 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white/90"
              >
                {qualityLabel}
              </span>
            </Poster>
          </div>

          <div className="glass-panel px-3 py-2.5">
            <h3
              dir="ltr"
              title={anime.titleEn}
              className="line-clamp-2 min-h-[2.6em] text-center text-sm font-extrabold leading-[1.3] text-white"
            >
              {anime.titleEn}
            </h3>
            <p className="mt-1 text-center text-xs text-content-muted">
              {faDigits(anime.year)} ·{" "}
              {anime.type === "فیلم"
                ? "فیلم"
                : `${faDigits(anime.availableEpisodes ?? anime.episodes)} قسمت`}
            </p>
          </div>
        </Link>

        <button
          type="button"
          onClick={() => toggleFavorite(anime.slug)}
          aria-label={fav ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"}
          aria-pressed={fav}
          className={cn(
            "absolute left-2 top-2 z-20 grid size-11 place-items-center rounded-full border transition-all duration-200 hover:scale-105",
            fav
              ? "border-rose-400/45 bg-rose-500/30 text-rose-300"
              : "border-white/15 bg-ink-950/50 text-white/85 hover:border-rose-400/45 hover:text-rose-300",
          )}
        >
          <Heart className={cn("size-3.5", fav && "fill-rose-400 text-rose-400")} />
        </button>
      </div>
    </article>
  );
}
