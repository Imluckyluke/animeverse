import type { MetadataRoute } from "next";
import { ANIME } from "@/lib/data";

const base = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  // Do not emit fake canonical URLs when the real public domain is not set.
  if (!base) return [];
  // Only indexable pages: /login and /favorites are noindex, so they stay out.
  const staticRoutes = ["", "/browse", "/privacy", "/terms"].map((route) => ({
    url: `${base}${route}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: route === "" ? 1 : 0.7,
  }));

  const animeRoutes = ANIME.map((anime) => ({
    url: `${base}/anime/${anime.slug}`,
    lastModified: new Date(anime.updatedAt),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  return [...staticRoutes, ...animeRoutes];
}
