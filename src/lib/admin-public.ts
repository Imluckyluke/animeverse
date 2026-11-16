import type { Anime } from "./catalog";

type PublicEntry = { revision: number; patch: Record<string, unknown> };
/** Final, validated server-published metadata wins over automatic artwork/MAL enrichment. */
export function applyPublishedAdmin(anime: Anime, entry?: PublicEntry): Anime {
  if (!entry) return anime;
  const patch = entry.patch;
  const next = { ...anime };
  for (const key of ["title", "titleEn", "titleJa", "studio", "synopsis", "cover", "banner"] as const) {
    if (typeof patch[key] === "string") next[key] = patch[key] as string;
  }
  if (typeof patch.year === "number") next.year = patch.year;
  if (Array.isArray(patch.genres) && patch.genres.every(value => typeof value === "string")) next.genres = patch.genres as string[];
  if (typeof patch.editorScore === "number" && patch.editorScore >= 0 && patch.editorScore <= 10) {
    next.score = patch.editorScore; next.scoreSource = "admin"; delete next.scoreReportedVia;
  }
  if (typeof patch.synopsis === "string") next.tagline = patch.synopsis.split("\n")[0].slice(0, 130);
  if (patch.pinned === true) next.featured = true;
  return next;
}
