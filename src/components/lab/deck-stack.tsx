"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { HeroAnime } from "@/lib/catalog";
import { LabCard } from "./lab-card";
import { cn, faDigits } from "@/lib/utils";

/**
 * A hand of posters: the top one is square to you, the rest are tucked behind
 * it. It deals itself every few seconds; the buttons take over from there.
 */
export function DeckStack({ items }: { items: HeroAnime[] }) {
  const reduce = useReducedMotion();
  const [start, setStart] = useState(0);
  const [paused, setPaused] = useState(false);
  const visible = items.slice(0, 4).map((_, index) => items[(start + index) % items.length]);

  useEffect(() => {
    if (reduce || paused || items.length < 3) return;
    const timer = window.setTimeout(() => setStart((value) => (value + 1) % items.length), 4200);
    return () => window.clearTimeout(timer);
  }, [start, items.length, paused, reduce]);

  return (
    <section
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="rounded-[26px] border border-white/[0.11] bg-[radial-gradient(circle_at_50%_0%,rgba(255,183,0,.09),transparent_58%)] p-4 backdrop-blur-md sm:p-5"
    >
      <header className="mb-2 flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold tracking-[0.16em] text-amber-300/80">دستهٔ پوسترها</p>
          <h3 className="mt-1 text-[15px] font-black text-white">یکی‌یکی رو کنار</h3>
        </div>
        <span className="text-[10px] tabular-nums text-white/35">
          {faDigits((start % items.length) + 1)} / {faDigits(items.length)}
        </span>
      </header>

      <div className="relative mx-auto mt-3 h-[318px] w-[204px]" style={{ perspective: "1000px" }}>
        <AnimatePresence initial={false}>
          {visible.map((anime, index) => (
            <motion.div
              key={anime.slug}
              className="absolute inset-x-0 top-0"
              style={{ zIndex: visible.length - index }}
              initial={{ y: -46, scale: 0.82, opacity: 0, rotate: 0 }}
              animate={{
                y: index * -13,
                scale: 1 - index * 0.055,
                rotate: index === 0 ? 0 : index % 2 === 0 ? -2.2 : 2.2,
                opacity: index === 0 ? 1 : 1 - index * 0.16,
                filter: index === 0 ? "blur(0px)" : `blur(${index * 0.8}px)`,
              }}
              exit={{ x: -190, rotate: -16, opacity: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <LabCard
                anime={anime}
                size={index === 0 ? "md" : "sm"}
                className={cn("w-[204px]", index !== 0 && "pointer-events-none")}
                priority={index === 0}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          type="button"
          aria-label="قبلی"
          onClick={() => setStart((value) => (value - 1 + items.length) % items.length)}
          className="grid size-9 place-items-center rounded-full border border-white/12 bg-white/[0.04] text-white/70 transition hover:border-amber-300/40 hover:text-amber-200"
        >
          <ChevronRight className="size-4" />
        </button>
        <div className="flex items-center gap-1.5">
          {items.slice(0, 8).map((anime, index) => (
            <span
              key={anime.slug}
              className={cn(
                "h-1 rounded-full transition-all duration-300",
                index === start % items.length ? "w-5 bg-amber-300" : "w-1.5 bg-white/20",
              )}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="بعدی"
          onClick={() => setStart((value) => (value + 1) % items.length)}
          className="grid size-9 place-items-center rounded-full border border-white/12 bg-white/[0.04] text-white/70 transition hover:border-amber-300/40 hover:text-amber-200"
        >
          <ChevronLeft className="size-4" />
        </button>
      </div>
    </section>
  );
}
