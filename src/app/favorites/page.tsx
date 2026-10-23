import type { Metadata } from "next";
import { FavoritesView } from "@/components/favorites-view";

export const metadata: Metadata = {
  title: "علاقه‌مندی‌های من",
  description: "لیست شخصی انیمه‌های موردعلاقهٔ تو در انیمه‌ورس؛ سریع به دانلود برگرد.",
};

export default function FavoritesPage() {
  return <FavoritesView />;
}
