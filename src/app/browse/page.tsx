import type { Metadata } from "next";
import { CatalogView } from "@/components/catalog-view";
import { ANIME, isChineseAnime } from "@/lib/data";
import { normalizeGenres } from "@/lib/genres";

const BROWSE_DESCRIPTION =
  "آرشیو کامل انیمه‌ورس: جست‌وجو کن و بر اساس ژانر، سال، نوع و وضعیت پخش فیلتر کن — لینک دانلود مستقیم با زیرنویس فارسی.";

export async function generateMetadata({
  searchParams: pending,
}: {
  searchParams: Promise<{
    genre?: string | string[];
    q?: string | string[];
    collection?: string | string[];
  }>;
}): Promise<Metadata> {
  const searchParams = await pending;
  // Filtered views are near-duplicates; keep them out of the index.
  const filtered = ["genre", "q", "collection"].some((key) => {
    const value = searchParams[key as "genre" | "q" | "collection"];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
  return {
    title: "آرشیو و جست‌وجوی انیمه",
    description: BROWSE_DESCRIPTION,
    alternates: { canonical: "/browse" },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

export default async function BrowsePage({
  searchParams: pending,
}: {
  searchParams: Promise<{
    genre?: string | string[];
    q?: string | string[];
    collection?: string | string[];
  }>;
}) {
  const searchParams = await pending;
  const rawGenre = Array.isArray(searchParams.genre)
    ? searchParams.genre.join(",")
    : searchParams.genre ?? "";
  const rawCollection = Array.isArray(searchParams.collection)
    ? searchParams.collection[0]
    : searchParams.collection;
  const collection = rawCollection === "chinese" ? "chinese" : "";
  // Genres on anime pages include many more labels than the curated home
  // shortcuts (e.g. شونن / ترسناک). Accept every genre that exists in the
  // catalog so a genre link always lands on a filtered archive.
  const availableGenres = new Set(ANIME.flatMap((anime) => anime.genres));
  const initialGenres = normalizeGenres(rawGenre).filter((g) => availableGenres.has(g));
  const initialQuery = Array.isArray(searchParams.q) ? searchParams.q[0] ?? "" : searchParams.q ?? "";

  // Cards do not need the heavy per-episode download payload. Sending it for
  // the whole catalog made /browse several megabytes on mobile. Keep the
  // detail page as the only place that receives episodeData.
  const catalogItems = (collection === "chinese" ? ANIME.filter(isChineseAnime) : ANIME).map(
    ({ episodeData: _episodeData, ...anime }) => anime,
  );

  return (
    <div className="shell py-8 sm:py-10">
      <h1 className="headline text-2xl sm:text-3xl">
        {collection === "chinese" ? "انیمه‌های چینی" : "آرشیو انیمه‌ها"}
      </h1>
      <div className="mt-6">
        <CatalogView
          key={`${collection}|${initialGenres.join(",")}|${initialQuery}`}
          items={catalogItems}
          initialQuery={initialQuery}
          initialGenres={initialGenres}
        />
      </div>
    </div>
  );
}
