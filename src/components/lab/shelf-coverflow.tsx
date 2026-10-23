"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import type { HeroAnime } from "@/lib/catalog";
import { cn, faDigits } from "@/lib/utils";
import { LabCard } from "./lab-card";

/**
 * Cover Flow: the row is a camera track. The case in the middle stands square
 * to the glass, the ones either side turn away, and the rest wait in the dark.
 */
export function ShelfCoverflow({
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

  const unit = useCallback(() => {
    const el = track.current;
    const card = el?.querySelector<HTMLElement>("[data-card]");
    return card ? card.offsetWidth + 16 : 210;
  }, []);

  const onScroll = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const index = Math.round(Math.abs(el.scrollLeft) / unit());
    setActive((prev) => (index === prev ? prev : Math.max(0, Math.min(items.length - 1, index))));
  }, [items.length, unit]);

  const go = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: dir * unit(), behavior: "smooth" });
  };

  useEffect(() => {
    onScroll();
  }, [onScroll]);

  return (
    <section>
      <header className="mb-4 flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h3 className="text-[15px] font-black text-white">{title}</h3>
          <span className="text-[10.5px] text-content-faint">{note}</span>
        </div>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-[10.5px] font-bold text-amber-300/85 transition-colors hover:text-amber-200"
        >
          همه
          <ArrowLeft className="size-3" />
        </Link>
      </header>

      <div className="relative -mx-4 sm:mx-0">
        <div
          ref={track}
          role="group"
          tabIndex={0}
          aria-label={title}
          onScroll={onScroll}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              go(1);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              go(-1);
            }
          }}
          className="hide-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-6 pt-6 focus-visible:outline-none sm:px-0"
          style={{ perspective: "1200px" }}
        >
          {items.map((anime, index) => {
            const d = index - active;
            const abs = Math.abs(d);
            const turn = Math.max(-2, Math.min(2, d));
            return (
              <div
                key={anime.slug}
                data-card
                className="shrink-0 snap-center transition-[transform,opacity] duration-500 ease-[cubic-bezier(.16,1,.3,1)]"
                style={{
                  transform: `rotateY(${turn * -24}deg) translateZ(${abs === 0 ? 0 : -70}px) scale(${
                    abs === 0 ? 1 : abs === 1 ? 0.9 : 0.8
                  })`,
                  opacity: abs > 2 ? 0.35 : 1,
                  zIndex: 30 - abs,
                  transformStyle: "preserve-3d",
                }}
              >
                <LabCard
                  anime={anime}
                  size={abs === 0 ? "md" : "sm"}
                  className="w-[58vw] max-w-[210px] sm:w-[200px]"
                />
              </div>
            );
          })}
        </div>

        <button
          type="button"
          aria-label="قبلی"
          onClick={() => go(-1)}
          className="absolute right-0 top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-[#12121a]/85 text-white backdrop-blur-md transition hover:border-amber-300/50 lg:grid"
        >
          <ChevronRight className="size-5" />
        </button>
        <button
          type="button"
          aria-label="بعدی"
          onClick={() => go(1)}
          className="absolute left-0 top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-[#12121a]/85 text-white backdrop-blur-md transition hover:border-amber-300/50 lg:grid"
        >
          <ChevronLeft className="size-5" />
        </button>
      </div>

      <div className="mt-1 flex items-center justify-center gap-1.5">
        {items.slice(0, 8).map((anime, index) => (
          <span
            key={anime.slug}
            className={cn(
              "h-1 rounded-full transition-all duration-300",
              index === active ? "w-6 bg-amber-300" : "w-1.5 bg-white/20",
            )}
          />
        ))}
        <span className="ms-2 text-[10px] tabular-nums text-white/35">
          {faDigits(active + 1)}/{faDigits(items.length)}
        </span>
      </div>
    </section>
  );
}
