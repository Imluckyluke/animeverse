"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import type { Anime } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { useCatalog } from "@/lib/admin-store";
import { AnimeCard } from "@/components/anime-card";
import { Coverflow } from "@/components/ui/coverflow";

const TABS = [
  { key: "latest", label: "تازه‌ها" },
  { key: "top", label: "برترین امتیازها" },
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
                "rounded-xl px-4 py-2.5 text-[12.5px] font-bold transition-[background-color,color,transform] duration-300 active:scale-[.98] motion-reduce:transform-none",
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
          className="group -my-2 inline-flex min-h-10 shrink-0 items-center gap-1.5 py-2 text-[12px] font-bold text-amber-300 transition-colors hover:text-white focus-visible:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/45"
        >
          بیشتر
          <ArrowLeft className="size-3.5 transition-transform duration-300 group-hover:-translate-x-1" />
        </Link>
      </div>

      <Coverflow
        ariaLabel={tab === "latest" ? "تازه‌ها" : "برترین امتیازها"}
        items={items}
        renderCard={(anime, i) => <AnimeCard anime={anime} index={i} fluid />}
      />
    </section>
  );
}
