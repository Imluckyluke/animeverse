/** Client-safe provenance helpers: no catalogue data or runtime imports. */
import type { Anime } from "./catalog";

type AvailabilityInput = Partial<Pick<Anime,
  "source" | "episodes" | "episodeData" | "totalEpisodes" | "indexedCount" | "availableEpisodes" | "highestEpisode"
>>;
type ScoreInput = Partial<Pick<Anime, "score" | "scoreSource" | "scoreReportedVia">>;

export type EpisodeAvailability = {
  indexedCount: number;
  readyCount: number;
  highestEpisode: number;
  totalEpisodes: number | null;
};

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isHttpUrl(value: string | undefined): boolean {
  if (!value || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Counts unique rows, not max episode number; "done" alone is not readiness. */
export function getEpisodeAvailability(anime: AvailabilityInput): EpisodeAvailability {
  const indexed = new Set<number>();
  const ready = new Set<number>();
  for (const episode of anime.episodeData ?? []) {
    if (!positiveInteger(episode.number)) continue;
    indexed.add(episode.number);
    if (episode.qualities.some((quality) => quality.status === "done" && isHttpUrl(quality.url))) {
      ready.add(episode.number);
    }
  }

  // Lightweight projections can carry server-computed index counts, but cannot
  // assert ready files without their actual quality URLs. An explicit [] wins.
  const indexedCount = anime.episodeData !== undefined ? indexed.size
    : positiveInteger(anime.indexedCount) ? anime.indexedCount
    : positiveInteger(anime.availableEpisodes) ? anime.availableEpisodes : 0;
  const highestEpisode = anime.episodeData !== undefined ? Math.max(0, ...indexed)
    : positiveInteger(anime.highestEpisode) ? anime.highestEpisode : 0;
  const declared = anime.totalEpisodes ?? (!["aniplus", "archive"].includes(anime.source || "") ? anime.episodes : undefined);

  return {
    indexedCount,
    readyCount: ready.size,
    highestEpisode,
    totalEpisodes: positiveInteger(declared) && declared >= highestEpisode ? declared : null,
  };
}

/** Latest indexed episode; its own date only, never a metadata-post timestamp. */
export function getLatestEpisode(anime: AvailabilityInput): { number: number; releasedAt: string | null } | null {
  const number = getEpisodeAvailability(anime).highestEpisode;
  if (!number) return null;
  const episode = anime.episodeData?.find(row => row.number === number);
  const releasedAt = episode?.releasedAt;
  return { number, releasedAt: releasedAt && Number.isFinite(Date.parse(releasedAt)) ? releasedAt : null };
}

/** Legacy seeded scores have no provenance and must not appear as reported. */
export function hasReportedScore(anime: ScoreInput): boolean {
  if (anime.scoreSource === "admin") return typeof anime.score === "number" && Number.isFinite(anime.score) && anime.score >= 0 && anime.score <= 10;
  return (anime.scoreSource === "mal" || anime.scoreSource === "aniplus")
    && typeof anime.score === "number" && Number.isFinite(anime.score)
    && anime.score > 0 && anime.score <= 10;
}

export function getScoreLabel(anime: ScoreInput): string {
  if (!hasReportedScore(anime)) return "";
  if (anime.scoreSource === "admin") return "امتیاز تحریریه";
  // Ingestion provenance stays internal; the public UI does not name channels.
  return anime.scoreSource === "mal" ? "MAL" : "امتیاز ثبت‌شده";
}
