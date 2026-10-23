"use client";

import { useState } from "react";
import { Check, ChevronDown, Download, HardDrive, Play } from "lucide-react";
import { cn, faDigits } from "@/lib/utils";

type Episode = {
  number: number;
  title: string;
  size: string;
  qualities: { label: string; size: string }[];
};

/**
 * A podcast-timeline read of the episode list: one rail, one dot per episode,
 * and the row you open unfolds in place instead of sending you elsewhere.
 */
export function EpisodeTimeline({
  show,
  episodes,
}: {
  show: string;
  episodes: Episode[];
}) {
  const [open, setOpen] = useState<number | null>(episodes[0]?.number ?? null);

  return (
    <section className="rounded-[26px] border border-white/[0.11] bg-white/[0.025] p-4 backdrop-blur-md sm:p-5">
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold tracking-[0.16em] text-amber-300/80">قسمت‌ها</p>
          <h3 className="mt-1 text-[15px] font-black text-white">
            {show}
            <span className="ms-2 text-[11px] font-bold text-white/40">
              {faDigits(episodes.length)} قسمت
            </span>
          </h3>
        </div>
        <span className="chip text-[10px]">فصل اول</span>
      </header>

      <ol className="relative">
        <span aria-hidden className="absolute inset-y-4 right-[13px] w-px bg-white/[0.10]" />

        {episodes.map((episode) => {
          const isOpen = open === episode.number;
          return (
            <li key={episode.number} className="relative pb-2 ps-9 last:pb-0">
              <span
                aria-hidden
                className={cn(
                  "absolute right-[7px] top-[18px] size-[13px] rounded-full border-2 transition-colors duration-300",
                  isOpen
                    ? "border-amber-300 bg-amber-300 shadow-[0_0_0_4px_rgba(255,183,0,.18)]"
                    : "border-white/25 bg-[#0b0b11]",
                )}
              />

              <div
                className={cn(
                  "overflow-hidden rounded-2xl border transition-colors duration-300",
                  isOpen
                    ? "border-amber-400/30 bg-amber-400/[0.05]"
                    : "border-white/[0.08] bg-white/[0.02] hover:border-white/20",
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : episode.number)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-3 py-3 text-right"
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-xl border text-[11px] font-black tabular-nums transition-colors",
                      isOpen
                        ? "border-amber-400/40 bg-amber-400/15 text-amber-200"
                        : "border-white/10 bg-white/[0.04] text-white/60",
                    )}
                  >
                    {faDigits(episode.number)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-bold text-white">
                      {episode.title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[10px] text-white/40">
                      <span className="inline-flex items-center gap-1">
                        <HardDrive className="size-2.5" />
                        {episode.size}
                      </span>
                      <span>{faDigits(episode.qualities.length)} کیفیت</span>
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-white/40 transition-transform duration-300",
                      isOpen && "rotate-180 text-amber-300",
                    )}
                  />
                </button>

                <div
                  className={cn(
                    "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="flex flex-wrap gap-2 border-t border-white/[0.07] px-3 py-3">
                      {episode.qualities.map((quality) => (
                        <button
                          key={quality.label}
                          type="button"
                          className="group/q flex items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.05] px-2.5 py-1.5 text-[10.5px] font-bold text-white/80 transition-colors hover:border-amber-400/45 hover:bg-amber-400/10 hover:text-amber-100"
                        >
                          <Download className="size-3 text-amber-300" />
                          {quality.label}
                          <span className="text-[9.5px] font-normal text-white/40">{quality.size}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        className="ms-auto inline-flex items-center gap-1.5 rounded-xl border border-white/[0.12] px-2.5 py-1.5 text-[10.5px] font-bold text-white/70 transition-colors hover:border-white/30 hover:text-white"
                      >
                        <Play className="size-3 fill-current" />
                        پخش
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-3 inline-flex items-center gap-1.5 text-[10px] text-white/35">
        <Check className="size-3 text-emerald-400/80" />
        این نماینده است؛ در صفحهٔ عنوان، این فهرست از دادهٔ واقعی ساخته می‌شود.
      </p>
    </section>
  );
}
