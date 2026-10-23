"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import type { Anime } from "@/lib/data";
import { cn } from "@/lib/utils";
import { useCatalog } from "@/lib/admin-store";
import { AnimeCard } from "@/components/anime-card";
import { Rail } from "@/components/ui/rail";

const TABS = [
  { key: "latest", label: "تازه‌ها" },
  { key: "top", label: "محبوب‌ها" },
] as const;

type Tab = (typeof TABS)[number]["key"];

/** One rail, two views — instead of two rails of the same cards. */
export function HomeRail({ latest, top }: { latest: Anime[]; top: Anime[] }) {
  const [tab, setTab] = useState<Tab>("latest");
  const latestList = useCatalog(latest);
  const topList = useCatalog(top);
  const items = tab === "latest" ? latestList : topList;

  return (
    <section className="shell section-pad">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-2xl border border-white/[0.1] bg-white/[0.04] p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={cn(
                "rounded-xl px-4 py-2 text-[12.5px] font-bold transition-colors duration-300",
                tab === t.key
                  ? "bg-amber-400/15 text-amber-200 shadow-inset"
                  : "text-content-muted hover:text-white",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Link
          href="/browse"
          className="group inline-flex shrink-0 items-center gap-1.5 text-[12px] font-bold text-amber-300 transition-colors hover:text-white"
        >
          بیشتر
          <ArrowLeft className="size-3.5 transition-transform duration-300 group-hover:-translate-x-1" />
        </Link>
      </div>

      <Rail ariaLabel={tab === "latest" ? "تازه‌ها" : "محبوب‌ها"}>
        {items.map((anime, i) => (
          <AnimeCard key={anime.slug} anime={anime} index={i} />
        ))}
      </Rail>
    </section>
  );
}
