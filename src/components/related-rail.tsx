"use client";

import type { Anime } from "@/lib/catalog";
import { AnimeCard } from "@/components/anime-card";
import { Coverflow } from "@/components/ui/coverflow";

export function RelatedRail({ items }: { items: Anime[] }) {
  return (
    <Coverflow
      ariaLabel="انیمه‌های مشابه"
      items={items}
      renderCard={(anime, index) => <AnimeCard anime={anime} index={index} fluid />}
    />
  );
}
