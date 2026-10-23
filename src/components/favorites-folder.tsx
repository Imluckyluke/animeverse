"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Heart, Search, X } from "lucide-react";
import type { Anime } from "@/lib/catalog";
import { faDigits } from "@/lib/utils";
import { useApp } from "@/lib/app-context";
import { CoverImage } from "@/components/ui/cover-image";
import GlassFolder, {
  type ArtRecipe,
  type FolderFile,
} from "@/components/ui/glass-folder-cards";

/** The site's amber, folded through orange and black, under the frosted front. */
const ART: ArtRecipe = {
  style: "marble",
  colors: ["#160d00", "#4a2a00", "#8a4f00", "#d18700", "#ffb300", "#ffe27a", "#fff7d6"],
  scale: 0.7,
  warp: 3.2,
  angle: -0.45,
  gloss: 0.55,
  veins: 0.4,
};

/** The saved list, dropped out of the folder once it is all the way open. */
function FavoritesList({ items, onClose }: { items: Anime[]; onClose: () => void }) {
  const { toggleFavorite } = useApp();
  const [query, setQuery] = useState("");
  const matches = items.filter((item) => `${item.title} ${item.titleEn}`.toLocaleLowerCase("fa").includes(query.trim().toLocaleLowerCase("fa")));

  return (
    <div className="overflow-hidden rounded-3xl border border-amber-400/25 bg-[#0c0c12] shadow-lift">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
        <span className="text-sm font-black text-white">لیست علاقه‌مندی‌ها · {faDigits(items.length)}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="بستن لیست"
          className="grid size-11 shrink-0 place-items-center rounded-full border border-white/[0.12] bg-white/[0.06] text-white/80 transition-colors hover:border-amber-400/40 hover:text-white"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <label className="mx-3 mt-3 flex items-center gap-2 rounded-xl border border-white/15 px-3">
        <Search className="size-4 shrink-0 text-content-muted" />
        <input type="search" aria-label="جست‌وجو در علاقه‌مندی‌ها" placeholder="پیدا کردن در لیست من…" value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 min-w-0 flex-1 bg-transparent text-base text-white outline-none sm:text-sm" />
      </label>
      <ul className="max-h-[52dvh] overflow-y-auto overscroll-contain p-2 lg:max-h-[56dvh]">
        {!matches.length ? <li className="p-5 text-center text-sm text-content-muted">عنوانی با این نام در لیستت نیست.</li> : null}
        {matches.map((anime) => (
          <li key={anime.slug} className="flex items-center gap-0.5">
            <Link
              href={`/anime/${anime.slug}`}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-white/[0.06]"
            >
              <span className="relative size-11 shrink-0 overflow-hidden rounded-xl border border-white/[0.12] bg-ink-900">
                <CoverImage
                  src={anime.cover ?? anime.banner ?? "/covers/placeholder.svg"}
                  alt=""
                  thumb
                  sizes="44px"
                  position="50% 18%"
                  className="rounded-xl"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  dir="ltr"
                  className="block truncate text-right text-[12.5px] font-bold text-white"
                >
                  {anime.titleEn}
                </span>
                <span className="mt-0.5 block text-[10.5px] text-content-muted">
                  {faDigits(anime.year)} ·{" "}
                  {anime.type === "فیلم"
                    ? "فیلم"
                    : `${faDigits(anime.availableEpisodes ?? anime.episodes)} قسمت`}
                </span>
              </span>
            </Link>
            <button
              type="button"
              onClick={(event) => {
                // Keep the press from reaching the outside-click closer: the row
                // is about to leave the DOM and would read as "outside".
                event.stopPropagation();
                toggleFavorite(anime.slug);
              }}
              aria-label={`برداشتن ${anime.titleEn} از علاقه‌مندی‌ها`}
              title="برداشتن از علاقه‌مندی‌ها"
              className="group/heart grid size-11 shrink-0 place-items-center rounded-full border border-white/[0.1] bg-white/[0.05] text-rose-300 transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-300 active:scale-90"
            >
              <Heart className="size-4 fill-current transition-transform group-hover/heart:scale-110" />
            </button>
            <ChevronLeft aria-hidden className="size-4 shrink-0 text-white/25" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The saved list, as a folder. It never closes all the way: at rest the covers
 * peek out of the pocket. Tapping it (or scrolling over it) opens it fully and
 * drops the whole list out underneath.
 */
export function FavoritesFolder({ items, width = 300 }: { items: Anime[]; width?: number }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const files: FolderFile[] = items.length
    ? items.map((anime) => ({
        name: anime.titleEn || anime.title,
        meta: faDigits(anime.year),
        image: anime.cover,
      }))
    : // Nothing saved yet: the folder holds one note that slides out and says so.
      [{ name: "خالیه!" }];

  // A tap anywhere else, or Escape, settles it back to the half-open rest.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      // A row we just removed is already detached, so it no longer "contains":
      // without this, un-saving from the list would close the folder with it.
      if (!target || !target.isConnected) return;
      if (!wrapRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Attach a beat later, or the very click that opened it closes it again.
    const timer = window.setTimeout(() => document.addEventListener("click", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("click", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative flex w-full flex-col items-center">
      <div
        className="relative"
        // Scrolling or dragging a finger over the folder is what opens it.
        onWheel={() => setOpen(true)}
        onTouchMove={() => setOpen(true)}
      >
        <GlassFolder
          label=""
          meta=""
          tone="dark"
          art={ART}
          seed={11}
          files={files}
          action="none"
          closeOnOutsidePress={false}
          className={items.length ? "fav-folder" : "fav-folder-empty"}
          width={width}
          labelPlacement="bottom-left"
          open={open}
          onOpenChange={setOpen}
          appearDelay={140}
        />
      </div>

      <div aria-hidden={!open} ref={(node) => { node?.toggleAttribute("inert", !open); }}
        className={`grid w-full max-w-[640px] transition-[grid-template-rows] duration-[340ms] ease-[cubic-bezier(.22,1,.36,1)] ${open && items.length ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0 overflow-hidden">
          <div className={`px-1 pb-1 pt-7 transition-[opacity,transform] duration-200 ${open ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"}`}>
            <FavoritesList items={items} onClose={() => setOpen(false)} />
          </div>
        </div>
      </div>
    </div>
  );
}
