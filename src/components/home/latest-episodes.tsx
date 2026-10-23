"use client";

import Link from "next/link";
import { ArrowLeft, Clapperboard, Download } from "lucide-react";
import { getEpisodes, splitQualities, type Anime } from "@/lib/catalog";
import { useCatalog } from "@/lib/admin-store";
import { cn, faDigits } from "@/lib/utils";
import { Poster } from "@/components/ui/poster";

/** A compact episode feed: different rhythm from the poster rail above it. */
export function LatestEpisodes({ items }: { items: Anime[] }) {
  const list = useCatalog(items).slice(0, 6);

  if (!list.length) return null;

  return (
    <section className="shell pb-6 sm:pb-8" aria-labelledby="latest-episodes-title">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
            <Clapperboard className="size-4" />
          </span>
          <div>
            <p className="text-[10.5px] font-bold text-amber-300/80">تازه رسیده</p>
            <h2 id="latest-episodes-title" className="headline text-lg sm:text-xl">
              آخرین قسمت‌ها
            </h2>
          </div>
        </div>

        <Link
          href="/browse"
          className="group inline-flex shrink-0 items-center gap-1.5 text-[12px] font-bold text-amber-300 transition-colors hover:text-white"
        >
          بیشتر
          <ArrowLeft className="size-3.5 transition-transform duration-300 group-hover:-translate-x-1" />
        </Link>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
        {list.map((anime, i) => {
          const episode = getEpisodes(anime)[0];
          const qualities = splitQualities(anime.quality);
          const qualityLabel = qualities.base.length
            ? [qualities.base[0], qualities.x265 ? "x265" : null].filter(Boolean).join(" · ")
            : qualities.all[0] ?? "HD";
          const episodeLabel =
            anime.type === "فیلم" ? "فیلم" : `قسمت ${faDigits(episode?.number ?? 1)}`;

          return (
            <Link
              key={anime.slug}
              href={`/anime/${anime.slug}#episodes`}
              aria-label={`${anime.titleEn} — ${episodeLabel}`}
              className={cn(
                "group flex min-w-0 items-center gap-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2.5 transition-all duration-300 hover:-translate-y-0.5 hover:border-amber-400/35 hover:bg-white/[0.055] hover:shadow-soft",
                i >= 4 && "hidden sm:flex",
              )}
            >
              <Poster
                anime={anime}
                sizes="80px"
                thumb
                position="50% 18%"
                className="size-16 shrink-0 rounded-xl sm:size-[72px]"
              />

              <div className="min-w-0 flex-1">
                <p dir="ltr" className="truncate text-[12.5px] font-extrabold text-white">
                  {anime.titleEn}
                </p>
                <p className="mt-0.5 truncate text-[10.5px] text-content-muted">{anime.title}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 text-[9.5px] font-bold text-amber-200">
                    {episodeLabel}
                  </span>
                  <span
                    dir="ltr"
                    className="rounded-md border border-white/[0.1] bg-white/[0.04] px-1.5 py-0.5 text-[9.5px] font-bold text-content-soft"
                  >
                    {qualityLabel}
                  </span>
                  {episode?.runtime ? (
                    <span className="hidden text-[9.5px] text-content-faint xs:inline">
                      {episode.runtime}
                    </span>
                  ) : null}
                </div>
              </div>

              <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/[0.1] bg-white/[0.04] text-content-muted transition-colors group-hover:border-amber-400/35 group-hover:text-amber-300">
                <Download className="size-3.5" />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
