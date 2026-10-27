import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AnimeDetailHero } from "@/components/anime/anime-detail-hero";
import { EpisodeList } from "@/components/anime/episode-list";
import { RelatedRail } from "@/components/related-rail";
import { SectionHead } from "@/components/ui/section-head";
import { ANIME, getAnime, getRelated, splitQualities } from "@/lib/data";
import { faDate, faDigits, faScore } from "@/lib/utils";
import { getEpisodeAvailability, getLatestEpisode, getScoreLabel, hasReportedScore } from "@/lib/catalog-metadata";

const siteBase = (process.env.NEXT_PUBLIC_SITE_URL || process.env.AV_PUBLIC_URL || "").replace(
  /\/+$/,
  "",
);

export const dynamicParams = false;

export function generateStaticParams() {
  return ANIME.map((anime) => ({ slug: anime.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const anime = getAnime(params.slug);
  if (!anime) return { title: "انیمه پیدا نشد" };
  const shareImage = anime.banner || anime.cover;
  const title = `${anime.titleEn} — دانلود با زیرنویس فارسی`;
  const description = `${anime.titleEn} (${anime.title}) — ${anime.synopsis}`;
  return {
    title,
    description,
    alternates: { canonical: `/anime/${anime.slug}` },
    openGraph: {
      title: `${anime.titleEn} | انیمه‌ورس`,
      description: anime.synopsis,
      type: "video.tv_show",
      ...(shareImage ? { images: [{ url: shareImage, alt: anime.titleEn }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: `${anime.titleEn} | انیمه‌ورس`,
      description: anime.synopsis,
      ...(shareImage ? { images: [shareImage] } : {}),
    },
  };
}

export default function AnimePage({ params }: { params: { slug: string } }) {
  const anime = getAnime(params.slug);
  if (!anime) notFound();
  const related = getRelated(anime, 8);
  const qualities = splitQualities(anime.quality);
  const availability = getEpisodeAvailability(anime);
  const latestEpisode = getLatestEpisode(anime);

  const hasStudio = Boolean(anime.studio) && anime.studio !== "—";
  const facts: { label: string; value: ReactNode }[] = [
    ...(hasStudio ? [{ label: "استودیو", value: anime.studio }] : []),
    { label: "سال / فصل", value: `${anime.year > 0 ? faDigits(anime.year) : "سال اعلام نشده"} · ${anime.season}` },
    { label: "قسمت‌های ثبت‌شده در آرشیو", value: faDigits(availability.indexedCount) },
    { label: "کل قسمت‌های اعلام‌شده", value: availability.totalEpisodes === null ? "اعلام نشده" : faDigits(availability.totalEpisodes) },
    { label: "قسمت‌های دارای لینک آماده در آخرین همگام‌سازی", value: faDigits(availability.readyCount) },
    { label: "امتیاز", value: hasReportedScore(anime) ? `${faScore(anime.score)} · ${getScoreLabel(anime)}` : "اعلام نشده" },
    { label: "زبان / صدا", value: anime.audio.join(" · ") },
    {
      label: "کیفیت‌ها",
      value: (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {qualities.base.map((quality) => (
            <span
              key={quality}
              dir="ltr"
              className="rounded-md border border-white/[0.12] bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-bold text-content-soft"
            >
              {quality}
            </span>
          ))}
          {qualities.x265 ? (
            <span
              dir="ltr"
              className="rounded-md border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-200"
            >
              x265
            </span>
          ) : null}
          {!qualities.base.length && !qualities.x265 ? (
            <span dir="ltr" className="text-[10px] font-bold text-content-soft">
              {anime.quality[0] ?? "HD"}
            </span>
          ) : null}
        </div>
      ),
    },
  ];

  const pageUrl = `${siteBase}/anime/${anime.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": anime.type === "فیلم" ? "Movie" : "TVSeries",
    name: anime.titleEn,
    alternateName: anime.title,
    description: anime.synopsis,
    url: pageUrl,
    mainEntityOfPage: pageUrl,
    ...(anime.cover || anime.banner ? { image: [anime.banner || anime.cover] } : {}),
    ...(anime.year > 0 ? { datePublished: String(anime.year), startDate: String(anime.year) } : {}),
    genre: anime.genres,
    ...(availability.totalEpisodes !== null ? { numberOfEpisodes: availability.totalEpisodes } : {}),
    ...(hasStudio ? { productionCompany: { "@type": "Organization", name: anime.studio } } : {}),
    inLanguage: "fa",
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <AnimeDetailHero anime={anime} latestEpisodeDateLabel={latestEpisode?.releasedAt ? faDate(latestEpisode.releasedAt, true) : ""} nextEpisodeLabel={anime.nextEpisodeAt ? faDate(anime.nextEpisodeAt) : ""} />

      <section id="episodes" className="shell scroll-mt-24 pb-4 pt-9 sm:pt-11">
        <EpisodeList anime={anime} />
      </section>

      <section id="info" className="shell section-pad scroll-mt-24">
        <h2 className="headline text-xl sm:text-2xl">دربارهٔ این عنوان</h2>
        <div className="glass-card mt-5 bg-[rgba(12,12,18,.78)] p-5 backdrop-blur-none sm:p-7 lg:bg-[rgba(10,10,16,.32)] lg:backdrop-blur-[8px]">
          <dl className="grid gap-x-8 gap-y-0 sm:grid-cols-2">
            {facts.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-3 border-b border-white/[0.07] py-3 last:border-0"
              >
                <dt className="shrink-0 text-[12px] text-content-faint">{row.label}</dt>
                <dd className="min-w-0 text-[12.5px] font-semibold text-content-soft">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="related" className="shell section-pad pb-10 scroll-mt-24">
        <SectionHead title="اگر این را دوست داشتی" href="/browse" />
        <RelatedRail items={related} />
      </section>
    </>
  );
}
