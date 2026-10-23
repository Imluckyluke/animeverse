"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import type { HeroAnime } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { LabCard } from "./lab-card";

/**
 * A glass pocket, cut from the same cloth as the favourites folder: the label
 * is a tab above the tray, the posters stand in the pocket, and the amber line
 * under it fills as you move through the shelf.
 */
export function ShelfPocket({
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
  const [progress, setProgress] = useState(0);
  const [edges, setEdges] = useState({ start: false, end: true });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const x = Math.abs(el.scrollLeft);
    setProgress(max > 4 ? Math.min(1, x / max) : 1);
    setEdges({ start: x > 6, end: x < max - 6 });
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  const step = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.82, behavior: "smooth" });
  };

  return (
    <div className="group/pocket relative">
      {/* folder tab */}
      <div className="relative z-10 flex h-11 items-end">
        <div className="flex items-center gap-3 rounded-t-[18px] border border-b-0 border-white/[0.11] bg-[rgba(18,18,26,.92)] px-4 pb-2 pt-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,.07)] backdrop-blur-md">
          <span className="text-[12.5px] font-black text-white">{title}</span>
          <span className="text-[10px] text-content-faint">{note}</span>
        </div>
        <Link
          href={href}
          className="mb-1 me-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold text-amber-300/85 transition-colors hover:text-amber-200"
        >
          همه
          <ArrowLeft className="size-3" />
        </Link>
      </div>

      {/* the pocket */}
      <div className="relative rounded-[26px] rounded-tr-[6px] border border-white/[0.11] bg-[rgba(12,12,18,.55)] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_26px_60px_-38px_rgba(0,0,0,.9)] backdrop-blur-[10px] backdrop-saturate-150">
        {/* the lip the posters stand behind */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-16 rounded-b-[26px] bg-gradient-to-t from-[#060609]/95 via-[#060609]/45 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-3 bottom-[3px] z-20 h-px bg-white/[0.10]"
        />

        <div
          ref={track}
          role="group"
          tabIndex={0}
          aria-label={title}
          onScroll={measure}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              step(1);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              step(-1);
            }
          }}
          className="hide-scrollbar -mt-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-0.5 pb-3 pt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b10]"
        >
          {items.map((anime) => (
            <LabCard
              key={anime.slug}
              anime={anime}
              className="w-[42vw] max-w-[176px] snap-start sm:w-[158px] lg:w-[166px]"
            />
          ))}
          <Link
            href={href}
            className="grid w-[26vw] max-w-[96px] shrink-0 snap-start place-items-center rounded-[20px] border border-dashed border-white/[0.14] text-[11px] font-bold text-content-muted transition-colors hover:border-amber-400/40 hover:text-amber-200"
          >
            همه
          </Link>
        </div>

        {/* arrows (desktop) */}
        <button
          type="button"
          aria-label="قبلی"
          onClick={() => step(-1)}
          className={cn(
            "absolute right-[-14px] top-1/2 z-30 hidden size-9 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-[#1a1a24]/95 text-white shadow-lift transition-opacity duration-300 lg:grid",
            edges.start
              ? "opacity-0 group-hover/pocket:opacity-100 group-focus-within/pocket:opacity-100 hover:opacity-100 focus-visible:opacity-100"
              : "pointer-events-none opacity-0",
          )}
        >
          <ChevronRight className="size-4" />
        </button>
        <button
          type="button"
          aria-label="بعدی"
          onClick={() => step(1)}
          className={cn(
            "absolute left-[-14px] top-1/2 z-30 hidden size-9 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-[#1a1a24]/95 text-white shadow-lift transition-opacity duration-300 lg:grid",
            edges.end
              ? "opacity-0 group-hover/pocket:opacity-100 group-focus-within/pocket:opacity-100 hover:opacity-100 focus-visible:opacity-100"
              : "pointer-events-none opacity-0",
          )}
        >
          <ChevronLeft className="size-4" />
        </button>

        {/* progress */}
        <div className="mx-1 mt-1 h-[3px] overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full rounded-full bg-gradient-to-l from-amber-300 to-amber-500 shadow-[0_0_10px_rgba(255,183,0,.55)] transition-[width] duration-150"
            style={{ width: `${Math.max(8, progress * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
