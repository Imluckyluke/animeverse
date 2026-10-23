import type { CSSProperties, ReactNode } from "react";
import type { Anime } from "@/lib/data";
import { artworkFor } from "@/lib/images";
import { cn } from "@/lib/utils";
import { CoverImage } from "@/components/ui/cover-image";

/**
 * Cover artwork. Uses real cover images when available and falls back to a
 * deterministic procedural composition built from the title palette.
 */
export function Poster({
  anime,
  className,
  children,
  style,
  sizes = "(max-width: 640px) 45vw, 240px",
  priority = false,
  thumb = false,
  position,
  scrim = false,
}: {
  anime: Anime;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  sizes?: string;
  priority?: boolean;
  /** Use the small card-sized image derivative. */
  thumb?: boolean;
  position?: string;
  scrim?: boolean;
}) {
  const { from, to, accent } = anime.art;
  const art = artworkFor(anime.slug);
  const cover = anime.cover || art?.cover;
  const blur = anime.cover ? undefined : art?.blur;
  const seed = anime.slug.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const angle = 140 + (seed % 7) * 12;
  const positioned = /(^|\s)(absolute|fixed|sticky)(\s|$)/.test(className ?? "");

  return (
    <div
      className={cn(
        "isolate overflow-hidden bg-ink-800",
        !positioned && "relative",
        className,
      )}
      style={{
        ...style,
        ...(cover ? null : { backgroundImage: `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)` }),
      }}
    >
      {cover ? (
        <CoverImage
          src={cover}
          blur={blur}
          sizes={sizes}
          priority={priority}
          thumb={thumb}
          position={position}
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(closest-side at 30% 20%, ${accent}, transparent 85%), radial-gradient(closest-side at 80% 90%, ${accent}, transparent 80%)`,
            opacity: 0.35,
          }}
        />
      )}

      {cover ? null : (
        <>
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(120% 80% at 85% 8%, rgba(255,255,255,.22), transparent 45%)",
            }}
          />
          <div aria-hidden className="poster-noise pointer-events-none absolute inset-0 opacity-[0.1]" />
        </>
      )}

      {scrim ? (
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-ink-950 via-ink-950/55 to-transparent"
        />
      ) : null}

      {children}
    </div>
  );
}
