"use client";

import type { CSSProperties } from "react";
import type { HeroAnime } from "@/lib/catalog";
import { artworkFor } from "@/lib/images";
import { COVER_VARIANTS } from "@/lib/artwork-overrides";
import { CoverImage } from "@/components/ui/cover-image";

type ArtworkInput = Pick<HeroAnime, "slug" | "cover" | "banner" | "coverAspectRatio" | "bannerAspectRatio">;

/** Portraits fill narrow screens; real landscape art keeps its native frame.
 * A softly extended background fills the remaining space without magnifying
 * a panoramic banner into a portrait-shaped crop.
 */
export function HeroArtwork({ anime, priority = false }: { anime: ArtworkInput; priority?: boolean }) {
  const fallback = artworkFor(anime.slug);
  const cover = anime.cover || fallback?.cover;
  const banner = anime.banner || fallback?.banner;
  const ratio = anime.bannerAspectRatio;
  const wide = banner && ratio && ratio >= 1.65 && ratio <= 5.5 ? banner : null;
  const portrait = cover || banner;
  if (!portrait) return null;
  // Extend muted poster colours, not an enlarged duplicate of the panorama.
  const ambient = portrait;
  const ambientSrc = COVER_VARIANTS[ambient]?.thumb ?? ambient;
  return (
    <>
      <div aria-hidden className="hero-art-ambient" style={{ backgroundImage: `url("${ambientSrc}")` }} />
      <div className={`hero-front-art${wide ? " hero-front-art--with-banner" : ""}${(anime.coverAspectRatio ?? 0) > 1.3 ? " hero-front-art--landscape" : ""}`} data-hero-art="portrait" style={{ "--hero-front-ratio": anime.coverAspectRatio } as CSSProperties}>
        <CoverImage src={portrait} sizes="(min-width: 1024px) 620px, 100vw" priority={priority} position="50% 25%" zoom={false} fit="cover" />
      </div>
      {wide ? <div className="hero-wide-art" data-hero-art="banner" style={{ "--hero-banner-ratio": ratio } as CSSProperties}>
        <CoverImage src={wide} sizes="100vw" priority={priority} position="50% 50%" zoom={false} fit="cover" />
      </div> : null}
    </>
  );
}
