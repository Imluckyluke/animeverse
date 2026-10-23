"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Heart, Play, RotateCcw, Star } from "lucide-react";
import type { HeroAnime } from "@/lib/catalog";
import type { LabAnime } from "./types";
import { CoverImage } from "@/components/ui/cover-image";
import { faDigits, faScore } from "@/lib/utils";

/**
 * Pointer parallax: the poster leans toward the cursor, its title floats above
 * the glass, and a fixed glare slides across the surface.
 */
export function TiltCard({ anime, width = "w-[190px]" }: { anime: HeroAnime; width?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pose, setPose] = useState({ rx: 0, ry: 0, gx: 50, gy: 50, on: false });

  return (
    <Link
      href={`/anime/${anime.slug}`}
      className={`group/t relative block shrink-0 ${width}`}
      style={{ perspective: "900px" }}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse" || !ref.current) return;
        const box = ref.current.getBoundingClientRect();
        const px = (event.clientX - box.left) / box.width;
        const py = (event.clientY - box.top) / box.height;
        setPose({
          rx: (0.5 - py) * 14,
          ry: (px - 0.5) * 16,
          gx: px * 100,
          gy: py * 100,
          on: true,
        });
      }}
      onPointerLeave={() => setPose({ rx: 0, ry: 0, gx: 50, gy: 50, on: false })}
    >
      <div
        ref={ref}
        className="relative aspect-[2/3] overflow-hidden rounded-[24px] border border-white/[0.13] bg-ink-900 shadow-[0_30px_60px_-30px_rgba(0,0,0,1)] transition-[transform,box-shadow] duration-200 ease-out"
        style={{
          transform: `rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) scale(${pose.on ? 1.02 : 1})`,
          transformStyle: "preserve-3d",
          boxShadow: pose.on
            ? "0 40px 70px -30px rgba(0,0,0,1), 0 0 40px -12px rgba(255,183,0,.35)"
            : undefined,
        }}
      >
        <CoverImage
          src={anime.cover ?? anime.banner ?? "/covers/placeholder.svg"}
          alt=""
          thumb
          sizes="(max-width: 640px) 46vw, 210px"
          position="50% 18%"
          className="transition-transform duration-700 group-hover/t:scale-[1.05]"
        />
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent" />

        <span
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover/t:opacity-100"
          style={{
            background: `radial-gradient(circle at ${pose.gx}% ${pose.gy}%, rgba(255,255,255,.3), transparent 55%)`,
            mixBlendMode: "screen",
          }}
        />

        <span
          className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-3.5"
          style={{ transform: "translateZ(34px)" }}
        >
          <span dir="ltr" className="line-clamp-2 text-right text-[14px] font-black leading-5 text-white">
            {anime.titleEn}
          </span>
          <span className="flex items-center gap-2 text-[11px] text-white/60">
            <span className="inline-flex items-center gap-1 font-bold text-amber-300">
              <Star className="size-3 fill-amber-300 text-amber-300" />
              {faScore(anime.score)}
            </span>
            <span>{faDigits(anime.year)}</span>
            <span className="ms-auto grid size-7 place-items-center rounded-full border border-white/25 bg-black/40 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/t:opacity-100">
              <Play className="size-3 fill-current" />
            </span>
          </span>
        </span>
      </div>
    </Link>
  );
}

/**
 * Two faces on one card: the poster, then the reason to watch it. Everything
 * the flip needs is already in the catalog, so the back is never a placeholder.
 */
export function FlipCard({ anime, width = "w-[200px]" }: { anime: LabAnime; width?: string }) {
  const [flipped, setFlipped] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div className={`shrink-0 ${width}`} style={{ perspective: "1200px" }}>
      <div
        ref={ref}
        className="relative aspect-[2/3] transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)] [transform-style:preserve-3d]"
        style={{ transform: flipped ? "rotateY(180deg)" : undefined }}
      >
        <button
          type="button"
          onClick={() => setFlipped(true)}
          aria-label={`پشت کارت ${anime.titleEn}`}
          aria-pressed={flipped}
          className="absolute inset-0 overflow-hidden rounded-[24px] border border-white/[0.13] bg-ink-900 text-right shadow-[0_30px_60px_-32px_rgba(0,0,0,1)] [backface-visibility:hidden]"
        >
          <CoverImage
            src={anime.cover ?? anime.banner ?? "/covers/placeholder.svg"}
            alt=""
            thumb
            sizes="(max-width: 640px) 48vw, 220px"
            position="50% 18%"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent" />
          <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3.5">
            <span dir="ltr" className="line-clamp-2 text-right text-[14px] font-black leading-5 text-white">
              {anime.titleEn}
            </span>
            <span className="flex items-center gap-1.5 text-[10.5px] text-white/55">
              <span>{faDigits(anime.year)}</span>
              <span className="text-amber-300/90">{anime.type}</span>
              <span className="ms-auto inline-flex items-center gap-1 rounded-full border border-white/20 px-2 py-0.5 text-[9.5px] text-white/70">
                <RotateCcw className="size-2.5" />
                بزن
              </span>
            </span>
          </span>
        </button>

        <div
          className="absolute inset-0 flex flex-col gap-2 overflow-hidden rounded-[24px] border border-amber-400/25 bg-[linear-gradient(160deg,#191207_0%,#0b0b11_55%,#101018_100%)] p-3.5 [backface-visibility:hidden]"
          style={{ transform: "rotateY(180deg)" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[9.5px] font-bold tracking-[0.16em] text-amber-300/80">چرا این را ببینم</span>
            <button
              type="button"
              onClick={() => setFlipped(false)}
              aria-label="بازگشت به پوستر"
              className="grid size-6 place-items-center rounded-full border border-white/15 text-white/70 transition hover:border-white/35 hover:text-white"
            >
              <RotateCcw className="size-3" />
            </button>
          </div>

          <p dir="ltr" className="text-right text-[12px] font-black leading-5 text-white">
            {anime.titleEn}
          </p>
          <p className="line-clamp-6 text-[10.5px] leading-5 text-white/65">{anime.synopsis}</p>

          <div className="mt-auto flex flex-wrap gap-1">
            {anime.genres.slice(0, 2).map((genre) => (
              <span key={genre} className="rounded-full border border-white/12 bg-white/[0.05] px-2 py-0.5 text-[9px] text-white/60">
                {genre}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <Link href={`/anime/${anime.slug}`} className="btn btn-primary btn-sm flex-1">
              <Play className="size-3 fill-current" />
              تماشا
            </Link>
            <button type="button" className="btn btn-glass btn-sm" aria-label="افزودن به علاقه‌مندی‌ها">
              <Heart className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
