"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Command, Search } from "lucide-react";
import type { Anime } from "@/lib/catalog";
import { searchAnime } from "@/lib/catalog";
import { CoverImage } from "@/components/ui/cover-image";
import { cn, faDigits } from "@/lib/utils";

/**
 * The archive's search, as a Raycast-style palette.
 *
 * The overlay is portalled to `document.body` on purpose: the archive's search
 * sits inside cards that use transforms and backdrop filters, and those turn
 * `position: fixed` into "fixed to that card" — the menu then opens at the
 * bottom of the page instead of over it.
 */
export function CommandPalette({ items }: { items: Anime[] }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((state) => !state);
        return;
      }
      if (!typing && event.key === "/") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      launcher.current?.focus({ preventScroll: true });
      return;
    }
    setQuery("");
    setCursor(0);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => input.current?.focus(), 40);
    return () => {
      document.body.style.overflow = previous;
      window.clearTimeout(timer);
    };
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim();
    if (!needle) return items.slice(0, 6);
    return searchAnime(items, { q: needle }).slice(0, 8);
  }, [items, query]);

  const go = (anime?: Anime) => {
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
        aria-haspopup="dialog"
        aria-expanded={open}
        className="group/search flex h-14 w-full items-center gap-2 rounded-2xl border border-white/[0.11] bg-[linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.025))] p-1.5 ps-2 text-right shadow-[inset_0_1px_0_rgba(255,255,255,.07),0_16px_38px_-30px_rgba(255,214,10,.32)] transition-[border-color,background-color,box-shadow] duration-300 hover:border-amber-400/35 focus-visible:border-amber-400/60 focus-visible:outline-none"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/[0.09] bg-white/[0.055] text-amber-300 shadow-[inset_0_1px_0_rgba(255,255,255,.08)] transition-colors duration-300 group-hover/search:border-amber-400/25 group-hover/search:bg-amber-400/10">
          <Search className="size-[18px]" strokeWidth={2.1} />
        </span>
        <span className="min-w-0 flex-1 truncate px-1.5 text-sm text-white/40">
          اسم انیمه را بنویس…
        </span>
        <span className="hidden items-center gap-0.5 rounded-lg border border-white/[0.1] bg-white/[0.04] px-1.5 py-1 text-[9.5px] font-bold text-white/35 sm:flex">
          <Command className="size-2.5" />K
        </span>
        <kbd className="me-1 grid h-7 min-w-7 place-items-center rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 font-sans text-[10px] font-bold text-white/35 sm:hidden">
          /
        </kbd>
      </button>

      {mounted
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <motion.div
                  className="fixed inset-0 z-[220] flex items-start justify-center bg-black/60 px-4 pt-[10vh] backdrop-blur-[7px]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  onClick={() => setOpen(false)}
                >
                  <motion.div
                    role="dialog"
                    aria-modal="true"
                    aria-label="جست‌وجوی سریع در آرشیو"
                    className="w-full max-w-lg overflow-hidden rounded-[24px] border border-white/[0.14] bg-[#0d0d14]/97 shadow-[0_50px_120px_-40px_rgba(0,0,0,1)]"
                    initial={{ opacity: 0, y: -16, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.98 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3">
                      <Search className="size-4 shrink-0 text-amber-300" />
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
                        aria-label="نام انیمه"
                        className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/30"
                      />
                      <kbd className="shrink-0 rounded-md border border-white/12 bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-white/40">
                        Esc
                      </kbd>
                    </div>

                    <ul className="max-h-[46vh] overflow-y-auto overscroll-contain p-2">
                      {results.length === 0 ? (
                        <li className="px-3 py-9 text-center text-[12px] text-white/35">
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
                                <span
                                  dir="ltr"
                                  className="block truncate text-right text-[12px] font-bold text-white"
                                >
                                  {anime.titleEn}
                                </span>
                                <span className="mt-0.5 block truncate text-[10px] text-white/40">
                                  {anime.title} · {faDigits(anime.year)}
                                </span>
                              </span>
                              <ArrowLeft
                                className={cn(
                                  "size-3.5 shrink-0 transition-opacity",
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
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}
