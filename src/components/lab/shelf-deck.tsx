import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { HeroAnime } from "@/lib/catalog";
import { faDigits } from "@/lib/utils";
import { LabCard } from "./lab-card";

/**
 * The shelf as a hand of files: the posters overlap like papers in a folder,
 * each one a little off-square, and the one you touch slides out of the pack.
 */
export function ShelfDeck({
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
    <section className="relative">
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

      <div className="hide-scrollbar -mx-4 flex items-end overflow-x-auto px-4 pb-4 pt-2 sm:mx-0 sm:px-0 [&>*+*]:-ms-8 sm:[&>*+*]:-ms-7">
        {items.map((anime, index) => (
          <div
            key={anime.slug}
            className="group/deck relative shrink-0 transition-[transform] duration-500 ease-[cubic-bezier(.16,1,.3,1)] hover:z-40 hover:-translate-y-3"
            style={{
              zIndex: index + 1,
              rotate: `${((index % 3) - 1) * 1.6}deg`,
            }}
          >
            <span className="pointer-events-none absolute -top-2 right-2 z-20 rounded-full border border-white/[0.14] bg-[#0b0b11]/90 px-1.5 py-0.5 text-[9px] font-black text-white/55 backdrop-blur-sm">
              {faDigits(index + 1)}
            </span>
            <LabCard
              anime={anime}
              className="w-[40vw] max-w-[168px] sm:w-[150px] lg:w-[158px]"
            />
            {/* the edge of the sheet behind it */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1.5 -bottom-1 h-2 rounded-b-[18px] bg-white/[0.06]"
            />
          </div>
        ))}

        <Link
          href={href}
          className="ms-3 grid h-[calc(40vw*1.5)] max-h-[252px] min-h-[180px] w-[26vw] max-w-[92px] shrink-0 place-items-center rounded-[20px] border border-dashed border-white/[0.14] text-[11px] font-bold text-content-muted transition-colors hover:border-amber-400/40 hover:text-amber-200"
        >
          همه
        </Link>
      </div>
    </section>
  );
}
