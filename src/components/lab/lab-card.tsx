import Link from "next/link";
import { Star } from "lucide-react";
import type { HeroAnime } from "@/lib/catalog";
import { CoverImage } from "@/components/ui/cover-image";
import { cn, faDigits, faScore } from "@/lib/utils";

const TYPE = {
  sm: { title: "text-[11.5px] leading-5", meta: "text-[10px]", pad: "p-2.5" },
  md: { title: "text-[13px] leading-5", meta: "text-[10.5px]", pad: "p-3" },
  lg: {
    title: "text-[15px] leading-6 sm:text-[16px]",
    meta: "text-[11.5px]",
    pad: "p-3.5",
  },
} as const;

/** The poster used by every sample: the tray changes, the card does not. */
export function LabCard({
  anime,
  className,
  priority = false,
  size = "md",
  radius = "rounded-[20px]",
  showMeta = true,
}: {
  anime: HeroAnime;
  className?: string;
  priority?: boolean;
  size?: keyof typeof TYPE;
  radius?: string;
  showMeta?: boolean;
}) {
  const t = TYPE[size];
  return (
    <Link
      href={`/anime/${anime.slug}`}
      className={cn("group/card relative block shrink-0", className)}
      aria-label={`${anime.titleEn} — ${faDigits(anime.year)}`}
    >
      <div
        className={cn(
          "relative overflow-hidden border border-white/[0.11] bg-ink-900 shadow-[0_22px_50px_-24px_rgba(0,0,0,.95)] transition-[border-color,box-shadow] duration-300 group-hover/card:border-amber-400/45 group-hover/card:shadow-[0_28px_60px_-22px_rgba(255,183,0,.22)]",
          radius,
        )}
      >
        <div className="relative aspect-[2/3]">
          <CoverImage
            src={anime.cover ?? anime.banner ?? "/covers/placeholder.svg"}
            alt=""
            thumb
            priority={priority}
            sizes="(max-width: 640px) 46vw, 240px"
            position="50% 18%"
            className="transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)] group-hover/card:scale-[1.05]"
          />
        </div>

        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent" />

        <span className={cn("absolute inset-x-0 bottom-0 flex flex-col gap-1", t.pad)}>
          <span
            dir="ltr"
            className={cn("line-clamp-1 text-right font-black text-white", t.title)}
          >
            {anime.titleEn}
          </span>
          {showMeta ? (
            <span className={cn("flex items-center gap-2 text-white/55", t.meta)}>
              <span>{faDigits(anime.year)}</span>
              <span className="text-amber-300/90">{anime.type}</span>
              <span className="ms-auto inline-flex items-center gap-1 font-bold text-white/75">
                <Star className="size-2.5 fill-amber-300 text-amber-300" />
                {faScore(anime.score)}
              </span>
            </span>
          ) : null}
        </span>
      </div>
    </Link>
  );
}
