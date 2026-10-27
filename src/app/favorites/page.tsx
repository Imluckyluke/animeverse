import type { Metadata } from "next";
import { FavoritesView } from "@/components/favorites-view";
import { ANIME } from "@/lib/data";

export const metadata: Metadata = {
  title: "کتابخانهٔ من",
  description: "علاقه‌مندی‌ها، انیمه‌های در حال تماشا و برنامهٔ بعدی تو در پوشه‌های شخصی انیمه‌ورس.",
  robots: { index: false, follow: true },
};

export default function FavoritesPage() {
  // Only the fields the folder renders — the per-episode payload stays server-side.
  const items = ANIME.map(({ slug, title, titleEn, year, type, episodes, availableEpisodes, cover, banner, score }) =>
    ({ slug, title, titleEn, year, type, episodes, availableEpisodes, cover, banner, score }));
  return <FavoritesView items={items} />;
}
