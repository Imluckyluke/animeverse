"use client";

import { useEffect, useRef } from "react";
import type { Anime } from "@/lib/catalog";
import { AnimeCard } from "@/components/anime-card";

/** One observer for the whole grid; previously revealed cards never replay. */
export function CatalogGrid({ items }: { items: Anime[] }) {
  const root = useRef<HTMLDivElement>(null);
  const identity = items.map((item) => item.slug).join("|");
  useEffect(() => {
    if (!root.current || !window.IntersectionObserver || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        (entry.target as HTMLElement).dataset.reveal = "visible";
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08 });
    root.current.querySelectorAll<HTMLElement>("[data-reveal]").forEach((node) => {
      if (node.dataset.reveal === "visible") return;
      node.dataset.reveal = "pending";
      observer.observe(node);
    });
    return () => {
      observer.disconnect();
      // If the list changes or the component goes away, never leave hidden content.
      root.current?.querySelectorAll<HTMLElement>('[data-reveal="pending"]').forEach((node) => { node.dataset.reveal = "ready"; });
    };
  }, [identity]);
  return <div ref={root} className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-5">
    {items.map((anime, index) => <div key={anime.slug} data-reveal="ready" className="catalog-reveal" style={{ animationDelay: `${index % 5 * 28}ms` }}>
      <AnimeCard anime={anime} fluid />
    </div>)}
  </div>;
}
