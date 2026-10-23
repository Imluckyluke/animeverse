"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, ChevronLeft, ChevronRight, Play, Star } from "lucide-react";
import type { HeroAnime } from "@/lib/catalog";
import { CoverImage } from "@/components/ui/cover-image";
import { cn, faDigits, faScore } from "@/lib/utils";

/**
 * A display case, version two: the active title's own artwork fills the glass
 * at nearly full strength, the poster running along the bottom is big enough
 * to read, and the case advances itself with a filling amber rule.
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

  const unit = useCallback(() => {
    const el = track.current;
    const card = el?.querySelector<HTMLElement>("[data-card]");
    return card ? card.offsetWidth + 12 : 200;
  }, []);

  const goTo = useCallback(
    (index: number) => {
      const el = track.current;
      if (!el) return;
      const next = (index + items.length) % items.length;
      el.scrollTo({ left: -next * unit(), behavior: "smooth" });
      setActive(next);
    },
    [items.length, unit],
  );

  const onScroll = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const index = Math.round(Math.abs(el.scrollLeft) / unit());
    setActive((prev) =>
      index === prev ? prev : Math.max(0, Math.min(items.length - 1, index)),
    );
  }, [items.length, unit]);

  return (
    <section className="relative overflow-hidden rounded-[30px] border border-white/[0.12] shadow-[0_40px_90px_-60px_rgba(0,0,0,1)]">
      {/* the active artwork, thrown across the whole case */}
      <div aria-hidden className="absolute inset-0">
        {items.map((anime, index) => (
          <motion.div
            key={anime.slug}
            className="absolute inset-0 bg-cover"
            style={{
              backgroundImage: `url("${anime.banner ?? anime.cover ?? ""}")`,
              backgroundPosition: "center 32%",
              filter: "blur(26px) saturate(1.35)",
            }}
            initial={false}
            animate={{
              opacity: index === active ? 0.85 : 0,
              scale: index === active ? 1.18 : 1.3,
            }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-l from-[#060609]/92 via-[#07070c]/62 to-[#060609]/28" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#060609] via-[#060609]/25 to-transparent" />
      </div>

      <div className="relative z-10 flex flex-col gap-4 p-4 sm:p-6">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[10px] font-bold tracking-[0.18em] text-amber-300/85">
              {title}
              <span className="h-px w-8 bg-amber-300/40" />
              <span className="text-white/35">{note}</span>
            </p>
            <h3
              dir="ltr"
              className="mt-2 line-clamp-2 text-right text-[19px] font-black leading-7 text-white sm:text-[24px] sm:leading-9"
            >
              {current?.titleEn ?? ""}
            </h3>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-white/70">
              <span className="inline-flex items-center gap-1 font-bold text-amber-300">
                <Star className="size-3.5 fill-amber-300 text-amber-300" />
                {current ? faScore(current.score) : ""}
              </span>
              <span>{current ? faDigits(current.year) : ""}</span>
              <span>{current?.type ?? ""}</span>
              <span className="line-clamp-1 max-w-[46ch] text-white/40">
                {current?.synopsis ?? ""}
              </span>
            </p>
          </div>
          <Link
            href={`/anime/${current?.slug ?? ""}`}
            className="btn btn-primary btn-md shrink-0 shadow-[0_18px_40px_-16px_rgba(255,183,0,.6)]"
          >
            <Play className="size-4 fill-current" />
            تماشا
          </Link>
        </header>

        <div className="relative">
          <div
            ref={track}
            role="group"
            tabIndex={0}
            aria-label={title}
            onScroll={onScroll}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                goTo(active + 1);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                goTo(active - 1);
              }
            }}
            className="hide-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 focus-visible:outline-none"
          >
            {items.map((anime, index) => (
              <Link
                key={anime.slug}
                href={`/anime/${anime.slug}`}
                data-card
                className={cn(
                  "group/v relative w-[44vw] max-w-[196px] shrink-0 snap-start overflow-hidden rounded-[18px] border transition-[border-color,transform,box-shadow] duration-500 sm:w-[184px] lg:w-[198px]",
                  index === active
                    ? "-translate-y-1 border-amber-300/80 shadow-[0_0_0_1px_rgba(255,214,10,.4),0_28px_50px_-24px_rgba(255,183,0,.65)]"
                    : "border-white/[0.12] hover:border-white/35",
                )}
              >
                <div className="relative aspect-[2/3]">
                  <CoverImage
                    src={anime.cover ?? anime.banner ?? "/covers/placeholder.svg"}
                    alt=""
                    thumb
                    sizes="(max-width: 640px) 44vw, 200px"
                    position="50% 18%"
                    className={cn(
                      "transition-transform duration-700",
                      index === active ? "scale-[1.03]" : "group-hover/v:scale-[1.05]",
                    )}
                  />
                  <span
                    className={cn(
                      "pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent transition-opacity duration-500",
                      index === active ? "opacity-60" : "opacity-90",
                    )}
                  />
                  <span
                    dir="ltr"
                    className="absolute inset-x-0 bottom-0 line-clamp-2 px-2 pb-2 text-center text-[10px] font-bold leading-4 text-white/90"
                  >
                    {anime.titleEn}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          <button
            type="button"
            aria-label="قبلی"
            onClick={() => goTo(active - 1)}
            className="absolute right-[-10px] top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-[#12121a]/90 text-white backdrop-blur-md transition hover:border-amber-300/50 hover:text-amber-200 lg:grid"
          >
            <ChevronRight className="size-5" />
          </button>
          <button
            type="button"
            aria-label="بعدی"
            onClick={() => goTo(active + 1)}
            className="absolute left-[-10px] top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-[#12121a]/90 text-white backdrop-blur-md transition hover:border-amber-300/50 hover:text-amber-200 lg:grid"
          >
            <ChevronLeft className="size-5" />
          </button>
        </div>

        <footer className="flex items-center gap-3">
          <span className="text-[10px] tabular-nums text-white/45">
            {faDigits(active + 1)} / {faDigits(items.length)}
          </span>
          <div className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
            <span
              className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-amber-300 to-amber-500 shadow-[0_0_10px_rgba(255,183,0,.5)] transition-[width] duration-500 ease-[cubic-bezier(.16,1,.3,1)]"
              style={{ width: `${((active + 1) / Math.max(1, items.length)) * 100}%` }}
            />
          </div>
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-[10.5px] font-bold text-amber-300/85 transition-colors hover:text-amber-200"
          >
            همه
            <ArrowLeft className="size-3" />
          </Link>
        </footer>
      </div>
    </section>
  );
}
