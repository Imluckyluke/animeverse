"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Download, Heart, Play, Star } from "lucide-react";
import type { HeroAnime } from "@/lib/catalog";
import { CoverImage } from "@/components/ui/cover-image";
import { faDigits, faScore } from "@/lib/utils";

/**
 * Apple-TV-style spotlight: the artwork drifts slower than the page, the title
 * sits on the image, and a strip of glass holds the facts.
 */
export function HeroSpotlight({ anime }: { anime: HeroAnime }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "16%"]);
  const scale = useTransform(scrollYProgress, [0, 1], [1.02, 1.14]);
  const fade = useTransform(scrollYProgress, [0, 0.9], [1, 0.25]);

  return (
    <div
      ref={ref}
      className="relative h-[clamp(440px,64vh,640px)] overflow-hidden rounded-[32px] border border-white/[0.12] bg-ink-900"
    >
      <motion.div
        aria-hidden
        className="absolute inset-0"
        style={reduce ? undefined : { y, scale, opacity: fade }}
      >
        <CoverImage
          src={anime.banner ?? anime.cover ?? "/covers/placeholder.svg"}
          alt=""
          priority
          position="50% 26%"
          sizes="(max-width: 640px) 100vw, 1200px"
          className="object-cover"
        />
      </motion.div>

      <div className="absolute inset-0 bg-gradient-to-t from-[#060609] via-[#060609]/45 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-l from-[#060609]/85 via-transparent to-[#060609]/30" />

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-4 p-5 sm:p-8">
        <div className="flex items-center gap-2">
          <span className="chip border-amber-400/35 bg-amber-400/15 text-[10px] font-black text-amber-200">
            انتخاب این هفته
          </span>
          <span className="chip text-[10px]">{anime.type}</span>
          <span className="chip text-[10px]">{anime.status}</span>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2
              dir="ltr"
              className="text-right text-[26px] font-black leading-9 text-white text-shadow-hero sm:text-[40px] sm:leading-[1.15]"
            >
              {anime.titleEn}
            </h2>
            <p className="mt-1 text-[12px] font-semibold text-white/70">{anime.title}</p>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px] text-white/75">
              <span className="inline-flex items-center gap-1 font-black text-amber-300">
                <Star className="size-3.5 fill-amber-300 text-amber-300" />
                {faScore(anime.score)}
              </span>
              <span>{faDigits(anime.year)}</span>
              <span>
                {anime.type === "فیلم"
                  ? "فیلم"
                  : `${faDigits(anime.availableEpisodes ?? anime.episodes)} قسمت`}
              </span>
              <span className="hidden text-white/45 sm:inline">
                {anime.synopsis.slice(0, 92)}…
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link href={`/anime/${anime.slug}`} className="btn btn-primary btn-lg">
              <Play className="size-4 fill-current" />
              تماشا
            </Link>
            <button type="button" className="btn btn-glass btn-lg" aria-label="افزودن به علاقه‌مندی‌ها">
              <Heart className="size-4" />
            </button>
            <button type="button" className="btn btn-glass btn-lg hidden sm:inline-flex">
              <Download className="size-4" />
              دانلود
            </button>
          </div>
        </div>
      </div>

      {/* scroll cue */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-1">
        <span className="relative h-8 w-px overflow-hidden bg-white/15">
          <motion.span
            className="absolute inset-x-0 top-0 h-3 bg-amber-300"
            animate={reduce ? undefined : { y: [-12, 32] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        </span>
      </div>
    </div>
  );
}
