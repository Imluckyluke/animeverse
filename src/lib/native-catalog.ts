import type { Anime } from "./catalog";
import { isChineseAnime } from "./catalog";

/** Public JSON contract for real native clients. No HTML, source bot links,
 * private archive identifiers, account data or administration credentials. */
export function nativeCatalog(items: Anime[], shelves: { hero?: string[]; movies?: string[] } = {}) {
  const titles = items.flatMap(anime => {
    const episodes = (anime.episodeData ?? []).flatMap(episode => {
      const qualities = episode.qualities.filter(q => q.status === "done" && /^https?:\/\/[^\s]+$/i.test(q.url ?? ""))
        .map(q => ({ label: q.label, url: q.url!, size: q.size ?? null }));
      return qualities.length && Number.isInteger(episode.number) && episode.number > 0
        ? [{ number: episode.number, runtime: episode.runtime, releasedAt: episode.releasedAt, title: episode.title, qualities }] : [];
    }).sort((a, b) => b.number - a.number);
    if (!episodes.length) return [];
    return [{
      slug: anime.slug, title: anime.title, titleEn: anime.titleEn, titleJa: anime.titleJa,
      year: anime.year, season: anime.season, type: anime.type, format: anime.format ?? "", status: anime.status,
      score: anime.score, scoreSource: anime.scoreSource ?? "unknown", studio: anime.studio,
      synopsis: anime.synopsis, tagline: anime.tagline, genres: anime.genres, audio: anime.audio,
      ageRating: anime.ageRating, quality: [...new Set(episodes.flatMap(e => e.qualities.map(q => q.label)))],
      cover: anime.cover ?? anime.banner ?? "", banner: anime.banner ?? anime.cover ?? "",
      coverAspectRatio: anime.coverAspectRatio ?? 0, bannerAspectRatio: anime.bannerAspectRatio ?? 0,
      totalEpisodes: anime.totalEpisodes ?? null, highestEpisode: episodes[0].number,
      readyCount: episodes.length, updatedAt: anime.updatedAt, nextEpisodeAt: anime.nextEpisodeAt ?? null,
      featured: shelves.hero ? shelves.hero.includes(anime.slug) : Boolean(anime.featured),
      heroOrder: shelves.hero?.includes(anime.slug) ? shelves.hero.indexOf(anime.slug) + 1 : null,
      cinema: shelves.movies ? shelves.movies.includes(anime.slug) : anime.type === "فیلم",
      rank: anime.rank ?? null, chinese: isChineseAnime(anime),
      art: anime.art, episodes,
    }];
  });
  return { schema: 1, source: "AnimeVerse", titles };
}
