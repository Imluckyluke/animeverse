import type { Anime } from "./catalog";

export type MetadataEntry = {
  identity: { titleEn?: string; titleJa?: string };
  providerId: number;
  data: Partial<Pick<Anime, "year" | "season" | "duration" | "studio" | "format" | "totalEpisodes">>;
};

function missing(value?: string): boolean {
  return !value || ["—", "-", "نامشخص", "نامعلوم"].includes(value);
}

/** Fill missing facts only, and invalidate any title/year identity mismatch. */
export function applyMetadata(anime: Anime, entries: Record<string, MetadataEntry>): Anime {
  const entry = entries[anime.slug];
  if (!entry || entry.identity.titleEn !== anime.titleEn || (entry.identity.titleJa ?? "") !== (anime.titleJa ?? "")) return anime;
  const data = entry.data;
  if (anime.year && data.year && anime.year !== data.year) return anime;
  const result = { ...anime };
  if (!anime.year && Number.isInteger(data.year) && data.year! >= 1900 && data.year! <= 2100) result.year = data.year!;
  if (missing(anime.season) && data.season) result.season = data.season;
  for (const key of ["studio", "duration", "format"] as const) if (missing(anime[key]) && data[key]) result[key] = data[key];
  if (!anime.totalEpisodes && Number.isInteger(data.totalEpisodes) && data.totalEpisodes! > 0 && data.totalEpisodes! >= (anime.highestEpisode ?? 0)) {
    result.totalEpisodes = data.totalEpisodes;
    result.episodes = data.totalEpisodes!;
  }
  return result;
}
