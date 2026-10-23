import type { Metadata } from "next";
import { FavoritesView } from "@/components/favorites-view";
import { ANIME } from "@/lib/data";

export const metadata: Metadata = {
  title: "علاقه‌مندی‌های من",
  description: "لیست شخصی انیمه‌های موردعلاقهٔ تو در انیمه‌ورس؛ سریع به دانلود برگرد.",
  robots: { index: false, follow: true },
};

export default function FavoritesPage() {
  // Only the fields the folder renders — the per-episode payload stays server-side.
  const items = ANIME.map(({ episodeData: _episodeData, ...anime }) => anime);
  return <FavoritesView items={items} />;
}
