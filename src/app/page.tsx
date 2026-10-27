import { Hero } from "@/components/home/hero";
import { HomeRail } from "@/components/home/home-rail";
import { LatestEpisodes } from "@/components/home/latest-episodes";
import { ChineseShelf, MoviesShelf } from "@/components/home/home-shelves";
import { ContinueWatching } from "@/components/home/continue-watching";
import type { HeroAnime } from "@/lib/catalog";
import {
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
  // Only five initial features cross the server/client boundary. Saved library
  // entries and an admin's extra pinned features are fetched on demand.
  const heroCandidates: HeroAnime[] = heroPool.map((anime) => ({
    slug: anime.slug,
    title: anime.title,
    titleEn: anime.titleEn,
    cover: anime.cover,
    banner: anime.banner,
    coverAspectRatio: anime.coverAspectRatio,
    bannerAspectRatio: anime.bannerAspectRatio,
    art: anime.art,
    score: anime.score,
    year: anime.year,
    type: anime.type,
    status: anime.status,
    episodes: anime.episodes,
    availableEpisodes: anime.availableEpisodes,
    highestEpisode: anime.highestEpisode,
    synopsis: anime.synopsis,
    source: anime.source,
    scoreSource: anime.scoreSource,
    scoreReportedVia: anime.scoreReportedVia,
  }));
  const movies = getMovies(12);
  const chinese = getChineseAnime(12);

  return (
    <>
      <Hero items={heroCandidates} />
      {/* Overlap the hero's bottom edge by a hairline with the page colour so a
          sub-pixel seam can never flash between the fade and the rails. */}
      <div className="relative -mt-0.5 bg-ink-950">
        <ContinueWatching />
        <LatestEpisodes items={latest.slice(0, 6)} />
        <HomeRail latest={latest} top={popular} />
        <MoviesShelf items={movies} />
        <ChineseShelf items={chinese} />
      </div>
    </>
  );
}
