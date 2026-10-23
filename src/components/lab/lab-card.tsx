import Link from "next/link";
import { Star } from "lucide-react";
import type { HeroAnime } from "@/lib/catalog";
import { CoverImage } from "@/components/ui/cover-image";
import { cn, faDigits, faScore } from "@/lib/utils";

/** The shared poster used by every sample shelf: same object, different tray. */
export function LabCard({
  anime,
  className,
  priority = false,
}: {
  anime: HeroAnime;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Link
      href={`/anime/${anime.slug}`}
      className={cn("group/card relative block shrink-0", className)}
      aria-label={`${anime.titleEn} — ${faDigits(anime.year)}`}
    >
      <div className="relative overflow-hidden rounded-[20px] border border-white/[0.11] bg-ink-900 shadow-[0_20px_45px_-22px_rgba(0,0,0,.95)] transition-[border-color,box-shadow] duration-300 group-hover/card:border-amber-400/45 group-hover/card:shadow-[0_26px_55px_-20px_rgba(255,183,0,.22)]">
        <div className="relative aspect-[2/3]">
          <CoverImage
            src={anime.cover ?? anime.banner ?? "/covers/placeholder.svg"}
            alt=""
            thumb
            priority={priority}
            sizes="(max-width: 640px) 44vw, 210px"
            position="50% 18%"
            className="transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)] group-hover/card:scale-[1.045]"
          />
        </div>

        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-black/25 to-transparent" />

        <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-2.5">
          <span
            dir="ltr"
            className="line-clamp-1 text-right text-[11.5px] font-black leading-5 text-white"
          >
            {anime.titleEn}
          </span>
          <span className="flex items-center gap-2 text-[10px] text-white/55">
            <span>{faDigits(anime.year)}</span>
            <span className="text-amber-300/90">{anime.type}</span>
            <span className="ms-auto inline-flex items-center gap-1 font-bold text-white/75">
              <Star className="size-2.5 fill-amber-300 text-amber-300" />
              {faScore(anime.score)}
            </span>
          </span>
        </span>
      </div>
    </Link>
  );
}
