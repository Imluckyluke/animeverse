import Link from "next/link";
import { ArrowLeft, Play } from "lucide-react";
import type { HeroAnime } from "@/lib/catalog";
import { CoverImage } from "@/components/ui/cover-image";
import { faDigits, faScore } from "@/lib/utils";

/**
 * Spotify's elastic row: every poster is a thin spine until you point at one,
 * then the spine widens and the rest of the row slides out of the way.
 */
export function RowElastic({
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

      <div className="hide-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-4 pt-1 sm:mx-0 sm:px-0">
        {items.map((anime, index) => (
          <Link
            key={anime.slug}
            href={`/anime/${anime.slug}`}
            className="group/e relative h-[228px] w-[112px] shrink-0 overflow-hidden rounded-[18px] border border-white/[0.11] bg-ink-900 shadow-[0_18px_40px_-26px_rgba(0,0,0,.95)] transition-[width,border-color,box-shadow] duration-500 ease-[cubic-bezier(.16,1,.3,1)] hover:w-[208px] hover:border-amber-400/45 hover:shadow-[0_24px_50px_-24px_rgba(255,183,0,.3)] focus-visible:w-[208px] focus-visible:border-amber-400/60 focus-visible:outline-none sm:h-[258px]"
          >
            <CoverImage
              src={anime.cover ?? anime.banner ?? "/covers/placeholder.svg"}
              alt=""
              thumb
              sizes="208px"
              position="50% 18%"
              className="transition-transform duration-700 group-hover/e:scale-[1.04]"
            />
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-black/25 to-transparent" />

            <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-2.5">
              <span
                dir="ltr"
                className="line-clamp-2 text-right text-[11px] font-black leading-4 text-white"
              >
                {anime.titleEn}
              </span>
              <span className="flex items-center gap-1.5 text-[9.5px] text-white/55">
                <span>{faDigits(anime.year)}</span>
                <span className="text-amber-300/90">{faScore(anime.score)}</span>
              </span>
            </span>

            <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-300 group-hover/e:opacity-100">
              <span className="grid size-11 place-items-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur-md">
                <Play className="size-4 fill-current" />
              </span>
            </span>

            <span className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/10" />
            <span className="pointer-events-none absolute bottom-2 left-2 text-[9px] font-black tabular-nums text-white/25">
              {faDigits(index + 1)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
