import type { HeroAnime } from "@/lib/catalog";

/** The hero shape plus the fields only the lab samples need. */
export type LabAnime = HeroAnime & {
  genres: string[];
};
