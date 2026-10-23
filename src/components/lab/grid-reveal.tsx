"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RotateCcw } from "lucide-react";
import type { HeroAnime } from "@/lib/catalog";
import { LabCard } from "./lab-card";
import { cn } from "@/lib/utils";

/**
 * The first second of a shelf, done properly: a shimmer that has the poster's
 * shape, then the artwork resolving out of blur, one card after another.
 */
export function GridReveal({ items }: { items: HeroAnime[] }) {
  const [run, setRun] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const timer = window.setTimeout(() => setReady(true), 850);
    return () => window.clearTimeout(timer);
  }, [run]);

  return (
    <section className="rounded-[26px] border border-white/[0.11] bg-white/[0.025] p-4 backdrop-blur-md sm:p-5">
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold tracking-[0.16em] text-amber-300/80">حالت بارگذاری</p>
          <h3 className="mt-1 text-[15px] font-black text-white">از اسکلت تا پوستر</h3>
        </div>
        <button
          type="button"
          onClick={() => {
            setReady(false);
            setRun((value) => value + 1);
          }}
          className="btn btn-glass btn-sm gap-1.5"
        >
          <RotateCcw className="size-3.5" />
          دوباره
        </button>
      </header>

      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
        {items.slice(0, 8).map((anime, index) => (
          <div key={`${run}-${anime.slug}`} className="relative aspect-[2/3]">
            {ready ? (
              <motion.div
                initial={{ opacity: 0, y: 16, filter: "blur(10px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{
                  duration: 0.6,
                  delay: index * 0.07,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="h-full"
              >
                <LabCard anime={anime} size="sm" className="h-full w-full" />
              </motion.div>
            ) : (
              <div
                className={cn(
                  "lab-shimmer h-full overflow-hidden rounded-[18px] border border-white/[0.08] bg-white/[0.035]",
                )}
                style={{ animationDelay: `${index * 0.12}s` }}
              >
                <div className="flex h-full flex-col justify-end gap-2 p-2.5">
                  <span className="h-2 w-4/5 rounded-full bg-white/[0.07]" />
                  <span className="h-2 w-2/5 rounded-full bg-white/[0.05]" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
