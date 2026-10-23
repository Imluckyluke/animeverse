import { Hero } from "@/components/home/hero";
import { HomeRail } from "@/components/home/home-rail";
import { LatestEpisodes } from "@/components/home/latest-episodes";
import { ChineseShelf, MoviesShelf } from "@/components/home/home-shelves";
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
  // The full pool is sent (without heavy episode payloads) so the client-side
  // admin star can promote any title into the hero immediately.
  const heroCandidates = [
    ...heroPool,
    ...ANIME.filter((anime) => !dailySlugs.has(anime.slug)),
  ].map(({ episodeData: _episodeData, ...anime }) => anime);
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
