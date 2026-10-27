import { NextRequest, NextResponse } from "next/server";
import { ANIME } from "@/lib/data";
import { getEpisodes } from "@/lib/catalog";

export function GET(request: NextRequest) {
  const slugs = [...new Set((request.nextUrl.searchParams.get("slugs") ?? "").split(","))]
    .filter(slug => /^[a-z0-9-]{1,160}$/.test(slug)).slice(0, 24);
  const bySlug = new Map(ANIME.map(anime => [anime.slug, anime]));
  const items = slugs.flatMap(slug => {
    const anime = bySlug.get(slug);
    if (!anime) return [];
    const { title, titleEn, cover, banner, coverAspectRatio, bannerAspectRatio, art, score, year, type, status, episodes, availableEpisodes, highestEpisode, synopsis, source, scoreSource, scoreReportedVia } = anime;
    return [{ slug, title, titleEn, cover, banner, coverAspectRatio, bannerAspectRatio, art, score, year, type, status, episodes, availableEpisodes, highestEpisode,
      source, scoreSource, scoreReportedVia, synopsis: synopsis.slice(0, 440), episodeNumbers: getEpisodes(anime).map(episode => episode.number) }];
  });
  return NextResponse.json(items, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
}
