import type { Metadata } from "next";
import { getAnime } from "@/lib/data";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "آماده‌سازی دانلود", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function DownloadPage({ searchParams }: { searchParams: { slug?: string; ep?: string; q?: string } }) {
  const anime = getAnime(searchParams.slug || "");
  const episode = Number(searchParams.ep);
  const quality = anime?.episodeData?.find(ep => ep.number === episode)?.qualities.find(q => q.label === searchParams.q && q.status === "done");
  if (!anime || !quality || !Number.isInteger(episode) || episode <= 0) {
    return <div className="shell py-16"><div className="glass-card mx-auto max-w-lg p-8 text-center"><h1 className="text-xl font-black text-white">فایل آماده پیدا نشد</h1><p className="mt-3 text-content-muted">از صفحهٔ انیمه، قسمت و کیفیت موجود را انتخاب کن.</p></div></div>;
  }
  redirect(`/anime/${anime.slug}?${new URLSearchParams({ download: String(episode), q: quality.label })}#episode-${anime.slug}-${episode}`);
}
