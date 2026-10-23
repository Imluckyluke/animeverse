import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { HeroAnime } from "@/lib/catalog";
import { LabCard } from "./lab-card";

/**
 * Two exposed strips that drift past on their own, opposite directions, and
 * stop the moment a finger or a pointer rests on them. Nothing is hidden: the
 * same posters are always there, just moving.
 */
export function ShelfMarquee({
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
  const top = items.slice(0, Math.ceil(items.length / 2));
  const bottom = items.slice(Math.ceil(items.length / 2));
  const row = (list: HeroAnime[], reverse = false, speed = 54) => (
    <div dir="ltr" className="flex w-max will-change-transform">
      <div
        className="lab-marquee flex w-max [&>*]:me-3"
        style={{
          animationDuration: `${speed}s`,
          animationDirection: reverse ? "reverse" : "normal",
        }}
      >
        {[0, 1].map((copy) =>
          list.map((anime) => (
            <LabCard
              key={`${copy}-${anime.slug}`}
              anime={anime}
              className="w-[118px] sm:w-[132px]"
            />
          )),
        )}
      </div>
    </div>
  );

  return (
    <section className="relative">
      <header className="mb-3 flex items-end justify-between gap-4">
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

      <div className="lab-marquee-hold relative -mx-4 overflow-hidden py-1 sm:mx-0">
        <div className="space-y-3">
          {row(top, false, 58)}
          {row([...bottom].reverse(), true, 46)}
        </div>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-l from-[#060609] to-transparent"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-r from-[#060609] to-transparent"
        />
      </div>
    </section>
  );
}
