"use client";

import Link from "next/link";
import { ArrowLeft, Check, Clock3, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/app-context";
import { nextAvailableEpisode } from "@/lib/library";
import type { HomeItem } from "@/lib/home-item";
import { faDigits } from "@/lib/utils";
import { CoverImage } from "@/components/ui/cover-image";

export function ContinueWatching() {
  const { ready, watched, library } = useApp();
  const [items, setItems] = useState<HomeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const slugs = useMemo(() => [...new Set([
    ...Object.keys(library).filter(slug => library[slug] === "watching"),
    ...Object.keys(watched).filter(slug => watched[slug].length > 0 && !["completed", "paused"].includes(library[slug])),
  ])].slice(0, 24).join(","), [watched, library]);

  useEffect(() => {
    if (!ready || !slugs) { setItems([]); return; }
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    fetch(`/api/catalog-items?${new URLSearchParams({ slugs })}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("catalog unavailable");
        const data = await response.json() as HomeItem[];
        if (!controller.signal.aborted) setItems(data);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ready, slugs, retry]);

  if (!ready || !slugs) return null;
  return (
    <section className="shell pb-8 pt-6 sm:pb-10 sm:pt-8" aria-labelledby="continue-title">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5"><Clock3 aria-hidden className="size-4 text-amber-300" /><h2 id="continue-title" className="headline text-lg sm:text-xl">ادامهٔ مسیر تو</h2></div>
        <Link href="/favorites" className="inline-flex min-h-11 items-center gap-1.5 text-xs font-bold text-content-soft hover:text-amber-200">کتابخانهٔ من<ArrowLeft aria-hidden className="size-3.5" /></Link>
      </div>
      {loading && !items.length ? <div role="status" className="flex h-28 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.025] text-sm text-content-muted"><Loader2 className="size-4 animate-spin" /> دریافت کتابخانه…</div> : null}
      {failed ? <button type="button" onClick={() => setRetry(value => value + 1)} className="btn btn-glass btn-md">دریافت لیست ناموفق بود؛ تلاش دوباره</button> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.slice(0, 6).map(anime => {
          const seen = watched[anime.slug] ?? [];
          const next = nextAvailableEpisode(anime.episodeNumbers, seen);
          const latest = anime.episodeNumbers.length ? Math.max(...anime.episodeNumbers) : null;
          const target = next ?? latest;
          return <Link key={anime.slug} href={`/anime/${anime.slug}${target === null ? "#episodes" : `#episode-${anime.slug}-${target}`}`} className="group flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3 transition-[border-color,background-color] duration-200 hover:border-amber-400/35 hover:bg-amber-400/[0.045]">
            <span className="relative h-24 w-[68px] shrink-0 overflow-hidden rounded-xl bg-ink-900"><CoverImage src={anime.cover ?? anime.banner ?? "/covers/placeholder.svg"} thumb sizes="68px" /></span>
            <span className="min-w-0 flex-1">
              <span dir="ltr" className="block truncate text-right text-sm font-extrabold text-white">{anime.titleEn}</span>
              <span className="mt-2 block text-xs font-bold text-amber-200">{next !== null ? seen.length ? `ادامه از قسمت ${faDigits(next)}` : `شروع از قسمت ${faDigits(next)}` : latest !== null ? "به آخرین قسمت موجود رسیدی" : "منتظر ثبت قسمت‌ها"}</span>
              <span className="mt-1.5 block text-[11px] leading-5 text-content-muted">{seen.length ? `${faDigits(seen.length)} قسمت دیده‌شده` : "در حال دنبال کردن"}{latest !== null ? ` · تا شمارهٔ ${faDigits(latest)} در آرشیو` : ""}</span>
            </span>
            {next !== null ? <ArrowLeft aria-hidden className="size-4 shrink-0 text-amber-300 transition-transform group-hover:-translate-x-0.5" /> : <Check aria-hidden className="size-4 shrink-0 text-content-muted" />}
          </Link>;
        })}
      </div>
    </section>
  );
}
