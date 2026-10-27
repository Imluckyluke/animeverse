import generatedArtwork from "./generated-artwork.json";
import generatedBanners from "./generated-banners.json";

const automated: Record<string, { cover?: string; banner?: string }> = { ...generatedArtwork.artwork };
for (const [slug, art] of Object.entries(generatedBanners.artwork as Record<string, { banner: string }>)) {
  automated[slug] = { ...automated[slug], ...art };
}
export const ARTWORK_OVERRIDES: Record<string, { cover?: string; banner?: string }> = {
  ...automated,
  "witch-hat-atelier": {
    cover: "/covers/curated/witch-hat-atelier.webp",
    banner: "/banners/curated/witch-hat-atelier.webp",
  },
};

/** Small cards do not download the full-resolution official artwork. */
export const COVER_VARIANTS: Record<string, { thumb: string; srcSet: string }> = {
  ...generatedArtwork.variants,
  ...generatedBanners.variants,
  "/covers/curated/witch-hat-atelier.webp": {
    thumb: "/covers/curated/witch-hat-atelier-thumb.webp",
    srcSet: "/covers/curated/witch-hat-atelier-640.webp 640w, /covers/curated/witch-hat-atelier-1280.webp 1280w, /covers/curated/witch-hat-atelier.webp 1800w",
  },
};
