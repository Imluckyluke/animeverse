import type { Metadata } from "next";
import { AdminView } from "@/components/admin-view";
import { ANIME, SITE } from "@/lib/data";

export const metadata: Metadata = {
  title: "پنل ادمین",
  description: "پنل مدیریت محلی انیمه‌ورس.",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  // Slim payload: the admin list never needs the per-episode download data.
  const items = ANIME.map(({ episodeData: _episodeData, ...anime }) => anime);
  return <AdminView items={items} telegramHandle={SITE.telegramHandle} />;
}
