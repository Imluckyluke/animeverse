"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Play, Star } from "lucide-react";
import type { HeroAnime } from "@/lib/catalog";
import { CoverImage } from "@/components/ui/cover-image";
import { cn, faDigits, faScore } from "@/lib/utils";

/**
 * A display case: the shelf's own artwork turns the glass behind the active
 * poster, and the row below stays slim so the case keeps the room.
 */
export function ShelfVitrine({
  title,
  note,
  items,
  href = "/browse",
}: {
  title: string;
  note: string;
  items: HeroAnime[];
  href?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const current = items[Math.min(active, items.length - 1)];

  const onScroll = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-card]");
    const unit = card ? card.offsetWidth + 10 : 100;
    const index = Math.round(Math.abs(el.scrollLeft) / unit);
    setActive(Math.max(0, Math.min(items.length - 1, index)));
  }, [items.length]);

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-white/[0.11] shadow-[0_30px_80px_-50px_rgba(0,0,0,.95)]">
      {/* the active poster, thrown onto the glass */}
      <div aria-hidden className="absolute inset-0 -z-0">
        {items.map((anime, index) => (
          <div
            key={anime.slug}
            className={cn(
              "absolute inset-0 bg-cover bg-center transition-opacity duration-700",
              index === active ? "opacity-45" : "opacity-0",
            )}
            style={{
              backgroundImage: `url("${anime.banner ?? anime.cover ?? ""}")`,
              filter: "blur(34px) saturate(1.15)",
              transform: "scale(1.15)",
            }}
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-l from-[#060609]/95 via-[#060609]/72 to-[#060609]/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#060609] via-transparent to-[#060609]/70" />
      </div>

      <div className="relative z-10 p-4 sm:p-6">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[0.18em] text-amber-300/80">{title}</p>
            <h3 dir="ltr" className="mt-1.5 line-clamp-2 text-right text-[17px] font-black leading-7 text-white sm:text-xl">
              {current?.titleEn ?? ""}
            </h3>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/65">
              <span className="inline-flex items-center gap-1 font-bold text-amber-300">
                <Star className="size-3 fill-amber-300 text-amber-300" />
                {current ? faScore(current.score) : ""}
              </span>
              <span>{current ? faDigits(current.year) : ""}</span>
              <span>{current?.type ?? ""}</span>
              <span className="text-white/35">{note}</span>
            </p>
          </div>
          <Link
            href={`/anime/${current?.slug ?? ""}`}
            className="btn btn-primary btn-sm shrink-0"
          >
            <Play className="size-3.5 fill-current" />
            تماشا
          </Link>
        </header>

        <div
          ref={track}
          role="group"
          tabIndex={0}
          aria-label={title}
          onScroll={onScroll}
          onKeyDown={(event) => {
            const el = track.current;
            if (!el) return;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              el.scrollBy({ left: -el.clientWidth * 0.7, behavior: "smooth" });
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              el.scrollBy({ left: el.clientWidth * 0.7, behavior: "smooth" });
            }
          }}
          className="hide-scrollbar mt-5 flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
        >
          {items.map((anime, index) => (
            <Link
              key={anime.slug}
              href={`/anime/${anime.slug}`}
              data-card
              className={cn(
                "group/v relative w-[24vw] max-w-[104px] shrink-0 snap-start overflow-hidden rounded-2xl border transition-[border-color,transform,box-shadow] duration-300",
                index === active
                  ? "border-amber-300/80 shadow-[0_0_0_1px_rgba(255,214,10,.35),0_18px_36px_-18px_rgba(255,183,0,.5)]"
                  : "border-white/[0.10] hover:border-white/30",
              )}
            >
              <div className="relative aspect-[2/3]">
                <CoverImage
                  src={anime.cover ?? anime.banner ?? "/covers/placeholder.svg"}
                  alt=""
                  thumb
                  sizes="104px"
                  position="50% 18%"
                />
                <span
                  className={cn(
                    "pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent transition-opacity",
                    index === active ? "opacity-70" : "opacity-100",
                  )}
                />
                <span
                  dir="ltr"
                  className="absolute inset-x-0 bottom-0 line-clamp-2 px-1.5 pb-1.5 text-center text-[9px] font-bold leading-4 text-white/85"
                >
                  {anime.titleEn}
                </span>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] tabular-nums text-white/40">
            {faDigits(active + 1)} از {faDigits(items.length)}
          </span>
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-[10.5px] font-bold text-amber-300/85 transition-colors hover:text-amber-200"
          >
            همه
            <ArrowLeft className="size-3" />
          </Link>
        </div>
      </div>
    </section>
  );
}
