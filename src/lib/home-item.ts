import type { HeroAnime } from "@/lib/catalog";

/** A small, on-demand response for local library entries, never the full catalogue. */
export type HomeItem = HeroAnime & { episodeNumbers: number[] };
