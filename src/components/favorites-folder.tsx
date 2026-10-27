"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, Heart, Search, X } from "lucide-react";
import type { Anime } from "@/lib/catalog";
import { faDigits } from "@/lib/utils";
import { useApp } from "@/lib/app-context";
import { searchTitles } from "@/lib/search";
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

/** Small enough to pass the whole catalogue without its synopses/episode data. */
export type FolderAnime = Pick<Anime,
  "slug" | "title" | "titleEn" | "year" | "type" | "episodes" |
  "availableEpisodes" | "cover" | "banner" | "score"
>;

type FavoritesFolderProps = {
  items: FolderAnime[];
  width?: number;
  label?: string;
  tone?: "light" | "dark";
  accent?: "amber" | "rose";
  /** Omit for favorites; null makes derived episode-history lists read-only. */
  onRemove?: ((slug: string) => void) | null;
};

/** The complete list is separate from the three lightweight cover previews. */
const FolderList = memo(function FolderList({ items, label, onClose, onRemove, favorite }: {
  items: FolderAnime[];
  label: string;
  onClose: () => void;
  onRemove: ((slug: string) => void) | null;
  favorite: boolean;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => searchTitles(items, query), [items, query]);

  return (
    <div className="folder-list-surface overflow-hidden rounded-3xl border border-amber-400/20 bg-[rgba(12,12,18,.9)] shadow-[0_20px_60px_rgba(0,0,0,.4),inset_0_1px_0_rgba(255,255,255,.08)]">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
        <span className="min-w-0 text-sm font-black text-white">{label} · {faDigits(items.length)}</span>
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
        <input type="search" aria-label={`جست‌وجو در ${label}`} placeholder="پیدا کردن در این پوشه…" value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 min-w-0 flex-1 bg-transparent text-base text-white outline-none sm:text-sm" />
      </label>
      {/* Native chaining scrolls the list first, then the page at either edge.
          Never cancel wheel/touch events: the scrollbar stays fully native. */}
      <ul data-folder-list className="max-h-[52dvh] overflow-y-auto overscroll-y-auto p-2 lg:max-h-[56dvh]">
        {!matches.length ? <li className="p-5 text-center text-sm leading-7 text-content-muted">{items.length ? "عنوانی با این نام در این پوشه نیست." : "هنوز عنوانی در این پوشه ذخیره نشده است."}</li> : null}
        {matches.map((anime) => (
          <li key={anime.slug} className="folder-list-row flex items-center gap-0.5">
            <Link
              href={`/anime/${anime.slug}`}
              prefetch={false}
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
                  {anime.year > 0 ? `${faDigits(anime.year)} · ` : ""}
                  {anime.type === "فیلم"
                    ? "فیلم"
                    : `${faDigits(anime.availableEpisodes ?? 0)} قسمت`}
                </span>
              </span>
            </Link>
            {onRemove ? <button
              type="button"
              onClick={(event) => {
                // Keep the press from reaching the outside-click closer: the row
                // is about to leave the DOM and would read as "outside".
                event.stopPropagation();
                onRemove(anime.slug);
              }}
              aria-label={`برداشتن ${anime.titleEn} از ${label}`}
              title={`برداشتن از ${label}`}
              className={`group/heart grid size-11 shrink-0 place-items-center rounded-full border border-white/[0.1] bg-white/[0.05] transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-300 active:scale-90 ${favorite ? "text-rose-300" : "text-content-muted"}`}
            >
              {favorite ? <Heart className="size-4 fill-current transition-transform group-hover/heart:scale-110" /> : <X className="size-4" />}
            </button> : null}
            <ChevronLeft aria-hidden className="size-4 shrink-0 text-white/25" />
          </li>
        ))}
      </ul>
    </div>
  );
});

/**
 * The saved list, as a folder. It never closes all the way: at rest the covers
 * peek out of the pocket. An intentional tap opens it fully and
 * drops the whole list out underneath.
 */
export function FavoritesFolder({ items, width = 300, label = "علاقه‌مندی‌ها", tone = "dark", accent = "amber", onRemove }: FavoritesFolderProps) {
  const { toggleFavorite } = useApp();
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(240);
  const wrapRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const listId = useId();
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const listOpen = open;
  const changeOpen = (next: boolean) => {
    if (next) setVisited(true);
    setOpen(next);
  };
  const closeList = useCallback(() => {
    setOpen(false);
    wrapRef.current?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus({ preventScroll: true });
  }, []);

  // Prepare the list before the first press, not in the folder's first motion
  // frame. Offscreen rows skip layout/paint and links do not prefetch every page.
  useEffect(() => {
    let idle = 0;
    const timer = window.setTimeout(() => {
      if (window.requestIdleCallback) idle = window.requestIdleCallback(() => setVisited(true), { timeout: 1500 });
      else setVisited(true);
    }, 500);
    return () => { clearTimeout(timer); if (idle) window.cancelIdleCallback(idle); };
  }, []);

  const files: FolderFile[] = useMemo(() => items.length
    ? items.slice(0, 3).map((anime) => ({
        name: anime.titleEn || anime.title,
        meta: anime.year > 0 ? faDigits(anime.year) : "سال اعلام نشده",
        image: anime.cover ?? anime.banner ?? "/covers/placeholder.svg",
      }))
    : // Nothing saved yet: the folder holds one note that slides out and says so.
      [{ name: "هنوز خالیه!" }], [items]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const measure = () => setAvailableWidth(Math.max(1, Math.floor(node.getBoundingClientRect().width - 32)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Name the folder surface with its heading and real count,
  // and real total, not the number of cover previews inside GlassFolder.
  useEffect(() => {
    const button = wrapRef.current?.querySelector<HTMLButtonElement>(".gf-hit");
    button?.setAttribute("aria-labelledby", titleId);
    button?.setAttribute("aria-controls", listId);
  }, [titleId, listId]);

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
      if (event.key === "Escape") {
        setOpen(false);
        wrapRef.current?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus({ preventScroll: true });
      }
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
    <div ref={wrapRef} className="relative flex w-full min-w-0 flex-col items-center overflow-x-clip">
      <h2 id={titleId} className="sr-only">{label} · {faDigits(items.length)} عنوان</h2>
      <div
        className="relative"
        onPointerDownCapture={event => { pointer.current = { x: event.clientX, y: event.clientY, moved: false }; }}
        onPointerMoveCapture={event => {
          const start = pointer.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) start.moved = true;
        }}
        onPointerCancelCapture={() => { if (pointer.current) pointer.current.moved = true; }}
        onClickCapture={event => {
          const moved = pointer.current?.moved;
          pointer.current = null;
          if (event.detail > 0 && moved) { event.preventDefault(); event.stopPropagation(); }
        }}
      >
        <GlassFolder
          label={label}
          meta={`${faDigits(items.length)} عنوان`}
          tone={tone}
          art={ART}
          seed={11}
          files={files}
          action="none"
          closeOnOutsidePress={false}
          className={`${items.length ? "fav-folder" : "fav-folder-empty"}${accent === "rose" ? " fav-folder-rose" : ""}`}
          width={Math.min(width, availableWidth)}
          labelPlacement="bottom-left"
          open={open}
          onOpenChange={changeOpen}
          onFileSelect={() => changeOpen(true)}
          appearDelay={140}
        />
      </div>

      <div id={listId} role="region" aria-labelledby={titleId} aria-hidden={!listOpen} ref={(node) => { node?.toggleAttribute("inert", !listOpen); }}
        className={`folder-list-region grid w-full max-w-[640px] ${listOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0 overflow-hidden">
          <div className={`folder-list-reveal px-1 pb-1 pt-7 transition-[opacity,transform] duration-[380ms] ease-[cubic-bezier(.25,.46,.3,1)] motion-reduce:transition-none ${listOpen ? "translate-y-0 opacity-100" : "-translate-y-5 opacity-0"}`}>
            {visited ? <FolderList items={items} label={label} onClose={closeList} onRemove={onRemove === undefined ? toggleFavorite : onRemove} favorite={onRemove === undefined} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
