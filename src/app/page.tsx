import { Hero } from "@/components/home/hero";
import { HomeRail } from "@/components/home/home-rail";
import { LatestEpisodes } from "@/components/home/latest-episodes";
import { ChineseShelf, MoviesShelf } from "@/components/home/home-shelves";
import type { HeroAnime } from "@/lib/catalog";
import {
  ANIME,
  getChineseAnime,
  getDailyPopularHero,
  getLatest,
  getMovies,
  getPopular,
} from "@/lib/data";

// Re-evaluate the daily hero and refresh the home page once a day.
export const revalidate = 86_400;

export default function HomePage() {
  const latest = getLatest(12);
  const popular = getPopular(12);
  const heroPool = getDailyPopularHero(5);
  const dailySlugs = new Set(heroPool.map((anime) => anime.slug));
  // The full pool is sent so the client-side admin star can promote any title
  // into the hero immediately, but only the handful of fields the hero renders
  // travel over the wire (the catalogue itself stays on the server).
  const heroCandidates: HeroAnime[] = [
    ...heroPool,
    ...ANIME.filter((anime) => !dailySlugs.has(anime.slug)),
  ].map((anime) => ({
    slug: anime.slug,
    title: anime.title,
    titleEn: anime.titleEn,
    cover: anime.cover,
    banner: anime.banner,
    art: anime.art,
    score: anime.score,
    year: anime.year,
    type: anime.type,
    status: anime.status,
    episodes: anime.episodes,
    availableEpisodes: anime.availableEpisodes,
    synopsis: anime.synopsis,
  }));
  const movies = getMovies(12);
  const chinese = getChineseAnime(12);

  return (
    <>
      <Hero items={heroCandidates} />
      <HomeRail latest={latest} top={popular} />
      <MoviesShelf items={movies} />
      <ChineseShelf items={chinese} />
      <LatestEpisodes items={latest.slice(0, 6)} />
    </>
  );
}
