import Link from "next/link";
import { cn, faDigits } from "@/lib/utils";

/**
 * A cloud instead of a list: each genre is a bubble whose size is its share of
 * the catalog, drifting slowly. Tap one to filter.
 */
export function GenreBubbles({
  genres,
}: {
  genres: { name: string; slug: string; count: number }[];
}) {
  const max = Math.max(...genres.map((genre) => genre.count), 1);

  return (
    <section className="rounded-[26px] border border-white/[0.11] bg-white/[0.025] p-4 backdrop-blur-md sm:p-6">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-[0.16em] text-amber-300/80">ژانرها</p>
          <h3 className="mt-1 text-[15px] font-black text-white">از کجا شروع کنم؟</h3>
        </div>
        <Link href="/browse" className="text-[10.5px] font-bold text-amber-300/85 hover:text-amber-200">
          همه ژانرها
        </Link>
      </header>

      <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
        {genres.map((genre, index) => {
          const share = genre.count / max;
          const size = 54 + Math.round(share * 52);
          return (
            <Link
              key={genre.slug}
              href={`/browse?genre=${encodeURIComponent(genre.slug)}`}
              className={cn(
                "lab-float group/b relative grid place-items-center rounded-full border border-white/[0.13] bg-[radial-gradient(circle_at_30%_25%,rgba(255,183,0,.22),rgba(255,255,255,.03)_58%,rgba(255,255,255,.015))] text-center shadow-[inset_0_1px_0_rgba(255,255,255,.09),0_16px_30px_-20px_rgba(0,0,0,.9)] transition-[transform,border-color,box-shadow] duration-300 hover:border-amber-300/55 hover:shadow-[0_20px_44px_-20px_rgba(255,183,0,.45)]",
              )}
              style={{
                width: size,
                height: size,
                animationDelay: `${(index % 7) * 0.45}s`,
                animationDuration: `${5 + (index % 4)}s`,
              }}
            >
              <span className="px-1.5 text-[10.5px] font-black leading-4 text-white/85 transition-colors group-hover/b:text-amber-100">
                {genre.name}
              </span>
              <span className="absolute -bottom-1 rounded-full border border-white/12 bg-[#0b0b11] px-1.5 text-[8.5px] tabular-nums text-white/45">
                {faDigits(genre.count)}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
