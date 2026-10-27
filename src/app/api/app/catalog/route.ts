import { NextResponse } from "next/server";
import { ANIME, getDailyPopularHero, getMovies } from "@/lib/data";
import { nativeCatalog } from "@/lib/native-catalog";

export const dynamic = "force-static";
export const revalidate = 3600;

export function GET() {
  return NextResponse.json(nativeCatalog(ANIME, { hero: getDailyPopularHero(5).map(a => a.slug), movies: getMovies(ANIME.length).map(a => a.slug) }), {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=1800" },
  });
}
