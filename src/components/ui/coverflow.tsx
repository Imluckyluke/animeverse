"use client";

import type { ReactNode } from "react";
import { CenteredCarousel } from "@/components/ui/centered-carousel";

export function Coverflow<T extends { slug: string }>({ items, renderCard, ariaLabel, className }: {
  items: T[];
  renderCard: (item: T, index: number) => ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  return <CenteredCarousel count={items.length} ariaLabel={ariaLabel} className={className}
    renderItem={index => renderCard(items[index], index)} />;
}
