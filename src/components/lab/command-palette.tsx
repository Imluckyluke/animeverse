"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Command, Search } from "lucide-react";
import type { HeroAnime } from "@/lib/catalog";
import { CoverImage } from "@/components/ui/cover-image";
import { cn, faDigits } from "@/lib/utils";

/**
 * Raycast-style palette: one keystroke opens the whole catalog, the list is
 * driven from the keyboard, and the launcher looks like a search field so the
 * shortcut is discoverable on a phone too.
 */
export function CommandPalette({
  items,
  shortcut = true,
}: {
  items: HeroAnime[];
  shortcut?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (!shortcut) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((state) => !state);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  useEffect(() => {
    if (!open) {
      launcher.current?.focus();
      return;
    }
    setQuery("");
    setCursor(0);
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => input.current?.focus(), 40);
    return () => {
      document.body.style.overflow = "";
      window.clearTimeout(timer);
    };
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items.slice(0, 5);
    return items
      .filter((anime) => `${anime.title} ${anime.titleEn}`.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [items, query]);

  const go = (anime?: HeroAnime) => {
    if (!anime) return;
    setOpen(false);
    router.push(`/anime/${anime.slug}`);
  };

  return (
    <>
      <button
        ref={launcher}
        type="button"
        onClick={() => setOpen(true)}
        className="group/s flex w-full items-center gap-3 rounded-2xl border border-white/[0.11] bg-white/[0.035] px-3.5 py-3 text-right backdrop-blur-md transition-colors hover:border-white/25"
      >
        <Search className="size-4 text-white/45 group-hover/s:text-amber-300" />
        <span className="flex-1 text-[12px] text-white/45">جست‌وجو در انیمه‌ورس…</span>
        <span className="hidden items-center gap-0.5 rounded-md border border-white/12 bg-white/[0.05] px-1.5 py-0.5 text-[9.5px] text-white/45 sm:flex">
          <Command className="size-2.5" />K
        </span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-[90] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-[6px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="جست‌وجوی سریع"
              className="w-full max-w-lg overflow-hidden rounded-[24px] border border-white/[0.14] bg-[#0d0d14]/95 shadow-[0_50px_120px_-40px_rgba(0,0,0,1)]"
              initial={{ opacity: 0, y: -14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3">
                <Search className="size-4 text-amber-300" />
                <input
                  ref={input}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setCursor(0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setCursor((index) => Math.min(results.length - 1, index + 1));
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setCursor((index) => Math.max(0, index - 1));
                    } else if (event.key === "Enter") {
                      event.preventDefault();
                      go(results[cursor]);
                    }
                  }}
                  placeholder="نام انیمه…"
                  className="flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/30"
                />
                <kbd className="rounded-md border border-white/12 bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-white/40">
                  Esc
                </kbd>
              </div>

              <ul className="max-h-[46vh] overflow-y-auto p-2">
                {results.length === 0 ? (
                  <li className="px-3 py-8 text-center text-[12px] text-white/35">
                    چیزی پیدا نشد.
                  </li>
                ) : (
                  results.map((anime, index) => (
                    <li key={anime.slug}>
                      <button
                        type="button"
                        onMouseEnter={() => setCursor(index)}
                        onClick={() => go(anime)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-right transition-colors",
                          index === cursor ? "bg-amber-400/[0.12]" : "hover:bg-white/[0.05]",
                        )}
                      >
                        <span className="relative h-12 w-9 shrink-0 overflow-hidden rounded-md border border-white/10">
                          <CoverImage
                            src={anime.cover ?? anime.banner ?? "/covers/placeholder.svg"}
                            alt=""
                            thumb
                            sizes="36px"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span dir="ltr" className="block truncate text-right text-[12px] font-bold text-white">
                            {anime.titleEn}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-white/40">
                            {anime.title} · {faDigits(anime.year)}
                          </span>
                        </span>
                        <ArrowLeft
                          className={cn(
                            "size-3.5 transition-opacity",
                            index === cursor ? "text-amber-300 opacity-100" : "opacity-0",
                          )}
                        />
                      </button>
                    </li>
                  ))
                )}
              </ul>

              <div className="flex items-center gap-3 border-t border-white/[0.08] px-4 py-2 text-[9.5px] text-white/30">
                <span>↑↓ جابه‌جایی</span>
                <span>↵ رفتن</span>
                <span className="ms-auto">انیمه‌ورس</span>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
