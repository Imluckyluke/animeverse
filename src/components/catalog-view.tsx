"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  RotateCcw,
  Search,
  SearchX,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Anime } from "@/lib/catalog";
import { GENRES, YEAR_OPTIONS, isChineseAnime, searchAnime } from "@/lib/catalog";
import { cn, faDigits, faNum } from "@/lib/utils";
import { useCatalog } from "@/lib/admin-store";
import { AnimeCard } from "@/components/anime-card";
import { Modal } from "@/components/ui/modal";

type Sort = "latest" | "score" | "views" | "alpha";

type Filters = {
  genres: string[];
  year: number | null;
  type: string | null;
  status: string | null;
  audio: string | null;
  sort: Sort;
};

const SORT_LABELS: Record<Sort, string> = {
  latest: "تازه‌ترین",
  score: "بالاترین امتیاز",
  views: "پربازدیدترین",
  alpha: "الفبایی",
};

const TYPES = ["سریال", "فیلم", "OVA"];
const STATUSES = ["در حال پخش", "پایان یافته"];
const AUDIOS = ["زیرنویس فارسی", "دوبله"];

const baseFilters: Filters = {
  genres: [],
  year: null,
  type: null,
  status: null,
  audio: null,
  sort: "latest",
};

export function CatalogView({
  items,
  initialQuery = "",
  initialGenres = [],
}: {
  items: Anime[];
  initialQuery?: string;
  initialGenres?: string[];
}) {
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<Filters>({ ...baseFilters, genres: initialGenres });
  const [draft, setDraft] = useState<Filters>(filters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [genreQuery, setGenreQuery] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const list = useCatalog(items);
  const searchParams = useSearchParams();
  const urlGenre = searchParams.get("genre") ?? "";
  const urlQuery = searchParams.get("q") ?? "";
  const urlYear = searchParams.get("year") ?? "";
  const urlType = searchParams.get("type") ?? "";
  const urlStatus = searchParams.get("status") ?? "";
  const urlAudio = searchParams.get("audio") ?? "";
  const urlSort = searchParams.get("sort") ?? "";
  const urlCollection = searchParams.get("collection") === "chinese" ? "chinese" : "";

  // A collection is a pre-filtered view (currently the Chinese donghua rail),
  // while the normal search/filter controls keep working inside it.
  const baseList = useMemo(
    () => (urlCollection === "chinese" ? list.filter(isChineseAnime) : list),
    [list, urlCollection],
  );

  const years = useMemo(
    () => Array.from(new Set([...YEAR_OPTIONS, ...baseList.map((a) => a.year)]))
      .filter((year) => Number.isFinite(year))
      .sort((a, b) => b - a),
    [baseList],
  );

  const allGenres = useMemo(() => {
    const curated: string[] = GENRES.map((genre) => genre.name);
    const names = new Set<string>(curated);
    for (const anime of baseList) {
      for (const genre of anime.genres) names.add(genre);
    }
    const extras = [...names]
      .filter((genre) => !curated.includes(genre))
      .sort((a, b) => a.localeCompare(b, "fa"));
    return [...curated, ...extras];
  }, [baseList]);

  const topGenres = GENRES.slice(0, 7);
  const selectedExtras = filters.genres.filter(
    (genre) => !topGenres.some((item) => item.name === genre),
  );

  const filteredGenres = useMemo(() => {
    const needle = genreQuery.trim().toLocaleLowerCase("fa");
    if (!needle) return allGenres;
    return allGenres.filter((genre) => genre.toLocaleLowerCase("fa").includes(needle));
  }, [allGenres, genreQuery]);

  const results = useMemo(
    () =>
      searchAnime(baseList, {
        q: query,
        genres: filters.genres,
        year: filters.year,
        type: filters.type,
        status: filters.status,
        audio: filters.audio,
        sort: filters.sort,
      }),
    [baseList, query, filters],
  );

  const activeCount =
    filters.genres.length +
    (filters.year ? 1 : 0) +
    (filters.type ? 1 : 0) +
    (filters.status ? 1 : 0) +
    (filters.audio ? 1 : 0);

  // Keep the client state in sync with links such as /browse?genre=اکشن.
  // The router can restore a cached CatalogView, so initial state alone is
  // not enough when navigating back from an anime page.
  useEffect(() => {
    const fromUrl = urlGenre
      .split(",")
      .map((genre) => genre.trim())
      .filter(Boolean);
    const parsedYear = urlYear ? Number(urlYear) : null;
    const year = parsedYear && Number.isFinite(parsedYear) ? parsedYear : null;
    const type = TYPES.includes(urlType) ? urlType : null;
    const status = STATUSES.includes(urlStatus) ? urlStatus : null;
    const audio = AUDIOS.includes(urlAudio) ? urlAudio : null;
    const sort =
      (Object.keys(SORT_LABELS) as Sort[]).find((value) => value === urlSort) ??
      "latest";
    setFilters((current) => {
      const same =
        current.genres.length === fromUrl.length &&
        current.genres.every((genre, index) => genre === fromUrl[index]) &&
        current.year === year &&
        current.type === type &&
        current.status === status &&
        current.audio === audio &&
        current.sort === sort;
      return same
        ? current
        : { ...current, genres: fromUrl, year, type, status, audio, sort };
    });
    setQuery(urlQuery);
    setUrlReady(true);
  }, [urlGenre, urlQuery, urlYear, urlType, urlStatus, urlAudio, urlSort]);

  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams();
    if (urlCollection) params.set("collection", urlCollection);
    if (query.trim()) params.set("q", query.trim());
    if (filters.genres.length) params.set("genre", filters.genres.join(","));
    if (filters.year) params.set("year", String(filters.year));
    if (filters.type) params.set("type", filters.type);
    if (filters.status) params.set("status", filters.status);
    if (filters.audio) params.set("audio", filters.audio);
    if (filters.sort !== "latest") params.set("sort", filters.sort);
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [query, filters, urlReady, urlCollection]);

  useEffect(() => {
    if (!sortOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!sortRef.current?.contains(event.target as Node)) setSortOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSortOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [sortOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const toggleGenre = (name: string) => {
    setFilters((f) => ({
      ...f,
      genres: f.genres.includes(name) ? f.genres.filter((g) => g !== name) : [...f.genres, name],
    }));
  };

  const reset = () => {
    setFilters({ ...baseFilters });
    setQuery("");
  };

  const openFilters = () => {
    setDraft(filters);
    setGenreQuery("");
    setFilterOpen(true);
  };

  const chips: { label: string; remove: () => void }[] = [
    ...filters.genres.map((g) => ({
      label: g,
      remove: () => setFilters((f) => ({ ...f, genres: f.genres.filter((x) => x !== g) })),
    })),
    ...(filters.year ? [{ label: String(filters.year), remove: () => setFilters((f) => ({ ...f, year: null })) }] : []),
    ...(filters.type ? [{ label: filters.type, remove: () => setFilters((f) => ({ ...f, type: null })) }] : []),
    ...(filters.status ? [{ label: filters.status, remove: () => setFilters((f) => ({ ...f, status: null })) }] : []),
    ...(filters.audio ? [{ label: filters.audio, remove: () => setFilters((f) => ({ ...f, audio: null })) }] : []),
  ];

  return (
    <div>
      <div className="group relative">
        <div className="flex h-14 items-center gap-2 rounded-2xl border border-white/[0.11] bg-[linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.025))] p-1.5 ps-2 shadow-[inset_0_1px_0_rgba(255,255,255,.07),0_16px_38px_-30px_rgba(255,214,10,.32)] transition-[border-color,background-color,box-shadow] duration-300 focus-within:border-amber-400/45 focus-within:bg-[linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.03))] focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_0_0_4px_rgba(255,214,10,.08),0_16px_38px_-30px_rgba(255,214,10,.4)]">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/[0.09] bg-white/[0.055] text-amber-300 shadow-[inset_0_1px_0_rgba(255,255,255,.08)] transition-colors duration-300 group-focus-within:border-amber-400/25 group-focus-within:bg-amber-400/10">
            <Search className="size-[18px]" strokeWidth={2.1} />
          </span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="اسم انیمه را بنویس…"
            aria-label="جست‌وجو در آرشیو"
            enterKeyHint="search"
            className="h-11 min-w-0 flex-1 bg-transparent px-1.5 text-sm text-white placeholder:text-content-faint focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="پاک کردن جست‌وجو"
              className="grid size-10 shrink-0 place-items-center rounded-xl text-content-muted transition-colors hover:bg-white/[0.07] hover:text-white"
            >
              <X className="size-4" />
            </button>
          ) : (
            <kbd className="me-1 hidden h-7 min-w-7 place-items-center rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 font-sans text-[10px] font-bold text-content-faint sm:grid">
              /
            </kbd>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 overflow-x-auto px-0.5 pb-1.5 no-scrollbar">
        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, genres: [] }))}
          className={cn(
            "shrink-0 rounded-full border px-3.5 py-2 text-[12px] font-bold transition-all",
            filters.genres.length === 0
              ? "border-amber-300 bg-amber-400 font-extrabold text-[#1a1206] shadow-[0_8px_22px_-12px_rgba(255,214,10,.55)]"
              : "border-white/[0.1] bg-white/[0.04] text-content-muted hover:border-white/20 hover:text-white",
          )}
        >
          همه
        </button>
        {selectedExtras.map((name) => (
          <button
            key={`selected-${name}`}
            type="button"
            onClick={() => toggleGenre(name)}
            aria-pressed
            className="shrink-0 rounded-full border border-amber-300 bg-amber-400 px-3.5 py-2 text-[12px] font-extrabold text-[#1a1206] shadow-[0_8px_22px_-12px_rgba(255,214,10,.55)] transition-all"
          >
            {name}
          </button>
        ))}
        {topGenres.map((g) => {
          const on = filters.genres.includes(g.name);
          return (
            <button
              key={g.name}
              type="button"
              onClick={() => toggleGenre(g.name)}
              aria-pressed={on}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-2 text-[12px] font-semibold transition-all",
                on
                  ? "border-amber-300 bg-amber-400 font-extrabold text-[#1a1206] shadow-[0_8px_22px_-12px_rgba(255,214,10,.55)]"
                  : "border-white/[0.1] bg-white/[0.04] text-content-muted hover:border-white/20 hover:text-white",
              )}
            >
              {g.name}
            </button>
          );
        })}
        <button
          type="button"
          onClick={openFilters}
          className="shrink-0 rounded-full border border-dashed border-white/[0.16] px-3.5 py-2 text-[12px] font-semibold text-content-muted transition-colors hover:border-amber-400/40 hover:text-white"
        >
          ژانر‌های بیشتر
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={openFilters} className="btn btn-glass btn-sm">
          <SlidersHorizontal className="size-3.5" />
          فیلتر‌ها
          {activeCount > 0 ? (
            <span className="grid size-5 place-items-center rounded-full bg-amber-400 text-[9px] font-black text-ink-950">
              {faNum(activeCount)}
            </span>
          ) : null}
        </button>

        <span className="text-[11px] text-content-muted">
          <span className="font-black text-white">{faNum(results.length)}</span> نتیجه
        </span>

        <div ref={sortRef} className="relative ms-auto">
          <button
            type="button"
            onClick={() => setSortOpen((open) => !open)}
            aria-label="مرتب‌سازی"
            aria-haspopup="listbox"
            aria-expanded={sortOpen}
            className={cn(
              "flex h-9 items-center gap-2 rounded-xl border px-3 text-[11px] font-semibold transition-colors",
              sortOpen
                ? "border-amber-400/40 bg-white/[0.075] text-white"
                : "border-white/[0.1] bg-white/[0.04] text-content-soft hover:border-white/20 hover:text-white",
            )}
          >
            <ArrowUpDown className="size-3.5 text-amber-300/80" />
            <span>{SORT_LABELS[filters.sort]}</span>
            <ChevronDown className={cn("size-3 text-content-faint transition-transform duration-200", sortOpen && "rotate-180")} />
          </button>
          {sortOpen ? (
            <div
              role="listbox"
              aria-label="مرتب‌سازی نتایج"
              className="absolute end-0 top-[calc(100%+8px)] z-40 w-44 overflow-hidden rounded-2xl border border-white/[0.12] bg-[rgba(13,13,20,.97)] p-1.5 shadow-[0_22px_50px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,.08)]"
            >
              {(Object.keys(SORT_LABELS) as Sort[]).map((sort) => {
                const active = filters.sort === sort;
                return (
                  <button
                    key={sort}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setFilters((current) => ({ ...current, sort }));
                      setSortOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-right text-[11px] transition-colors",
                      active
                        ? "bg-amber-400/10 font-bold text-amber-200"
                        : "text-content-muted hover:bg-white/[0.06] hover:text-white",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-full border",
                        active
                          ? "border-amber-400/45 bg-amber-400/15 text-amber-300"
                          : "border-white/10 bg-white/[0.03] text-transparent",
                      )}
                    >
                      <Check className="size-3" />
                    </span>
                    {SORT_LABELS[sort]}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {chips.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {chips.map((c, i) => (
            <button
              key={`${c.label}-${i}`}
              type="button"
              onClick={c.remove}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold text-content-soft transition-colors hover:border-danger/30 hover:text-danger"
            >
              {c.label}
              <X className="size-2.5" />
            </button>
          ))}
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 px-1 text-[10px] font-semibold text-content-faint transition-colors hover:text-white"
          >
            <RotateCcw className="size-3" />
            پاک کردن همه
          </button>
        </div>
      ) : null}

      <div className="mt-6">
        {results.length === 0 ? (
          <div className="rounded-3xl border border-white/[0.07] bg-white/[0.02] px-6 py-16 text-center">
            <div className="mx-auto grid size-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-content-muted">
              <SearchX className="size-7" />
            </div>
            <h3 className="mt-4 text-lg font-black text-white">چیزی پیدا نشد</h3>
            <p className="mx-auto mt-2 max-w-sm text-[11px] leading-6 text-content-muted">
              با این فیلتر‌ها عنوانی نداریم. عبارت دیگری را امتحان کن یا فیلتر‌ها را پاک کن.
            </p>
            <button type="button" onClick={reset} className="btn btn-primary btn-md mt-5">
              <RotateCcw className="size-3.5" />
              نمایش همهٔ عنوان‌ها
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-5">
            {results.map((anime, i) => (
              <AnimeCard key={anime.slug} anime={anime} index={i} fluid />
            ))}
          </div>
        )}
      </div>

      <Modal open={filterOpen} onClose={() => setFilterOpen(false)} title="فیلتر‌ها">
        <div className="space-y-5">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-bold text-content-soft">ژانر‌ها</p>
              <span className="text-[9.5px] font-semibold text-content-faint">
                {draft.genres.length
                  ? `${faNum(draft.genres.length)} انتخاب`
                  : `${faNum(allGenres.length)} ژانر`}
              </span>
            </div>

            {draft.genres.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {draft.genres.map((name) => (
                  <button
                    key={`draft-${name}`}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({ ...d, genres: d.genres.filter((x) => x !== name) }))
                    }
                    className="inline-flex items-center gap-1 rounded-full border border-amber-300/70 bg-amber-400 px-2.5 py-1 text-[9.5px] font-bold text-[#1a1206]"
                  >
                    {name}
                    <X className="size-2.5" />
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-2.5 flex h-10 items-center gap-2 rounded-xl border border-white/[0.09] bg-black/20 px-2.5 transition-colors focus-within:border-amber-400/35">
              <Search className="size-3.5 shrink-0 text-content-faint" />
              <input
                type="search"
                value={genreQuery}
                onChange={(event) => setGenreQuery(event.target.value)}
                placeholder="جست‌وجوی ژانر…"
                aria-label="جست‌وجوی ژانر"
                className="min-w-0 flex-1 bg-transparent text-[11px] text-white placeholder:text-content-faint focus:outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {genreQuery ? (
                <button
                  type="button"
                  onClick={() => setGenreQuery("")}
                  aria-label="پاک کردن جست‌وجوی ژانر"
                  className="grid size-6 place-items-center rounded-lg text-content-faint hover:bg-white/[0.07] hover:text-white"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>

            <div className="mt-2.5 max-h-[176px] overflow-y-auto overscroll-contain pe-0.5">
              {filteredGenres.length ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {filteredGenres.map((name) => {
                    const on = draft.genres.includes(name);
                    return (
                      <button
                        key={name}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            genres: on ? d.genres.filter((x) => x !== name) : [...d.genres, name],
                          }))
                        }
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-right text-[10px] font-semibold transition-colors",
                          on
                            ? "border-amber-400/45 bg-amber-400/12 text-amber-200"
                            : "border-white/[0.08] bg-white/[0.025] text-content-muted hover:border-white/15 hover:text-white",
                        )}
                      >
                        <span className="truncate">{name}</span>
                        <span
                          className={cn(
                            "grid size-4 shrink-0 place-items-center rounded-full border",
                            on
                              ? "border-amber-400/50 bg-amber-400 text-[#1a1206]"
                              : "border-white/10 text-transparent",
                          )}
                        >
                          <Check className="size-2.5" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-[10px] text-content-faint">
                  ژانری با این نام پیدا نشد.
                </p>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-bold text-content-soft">سال</p>
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, year: null }))}
                className={cn(
                  "text-[9.5px] font-semibold transition-colors",
                  draft.year === null ? "text-amber-300" : "text-content-faint hover:text-white",
                )}
              >
                همه سال‌ها
              </button>
            </div>
            <div className="mt-2 grid max-h-[126px] grid-cols-4 gap-1.5 overflow-y-auto overscroll-contain pe-0.5">
              {years.map((year) => {
                const on = draft.year === year;
                return (
                  <button
                    key={year}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDraft((d) => ({ ...d, year: on ? null : year }))}
                    className={cn(
                      "rounded-xl border px-2 py-2 text-[10px] font-semibold transition-colors",
                      on
                        ? "border-amber-400 bg-amber-400 font-bold text-[#1a1206]"
                        : "border-white/10 bg-white/[0.03] text-content-muted hover:border-white/20 hover:text-white",
                    )}
                  >
                    {faDigits(year)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-bold text-content-soft">نوع</p>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                aria-pressed={draft.type === null}
                onClick={() => setDraft((d) => ({ ...d, type: null }))}
                className={cn(
                  "rounded-xl border px-2 py-2 text-[10px] font-semibold transition-colors",
                  draft.type === null
                    ? "border-amber-400 bg-amber-400 font-bold text-[#1a1206]"
                    : "border-white/10 bg-white/[0.03] text-content-muted hover:text-white",
                )}
              >
                همه
              </button>
              {TYPES.map((type) => {
                const on = draft.type === type;
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDraft((d) => ({ ...d, type: on ? null : type }))}
                    className={cn(
                      "rounded-xl border px-2 py-2 text-[10px] font-semibold transition-colors",
                      on
                        ? "border-amber-400 bg-amber-400 font-bold text-[#1a1206]"
                        : "border-white/10 bg-white/[0.03] text-content-muted hover:text-white",
                    )}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-bold text-content-soft">وضعیت پخش</p>
            <div className="grid grid-cols-2 gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, status: d.status === s ? null : s }))}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-[10px] font-semibold transition-colors",
                    draft.status === s
                      ? "border-amber-400/40 bg-amber-400/12 text-amber-200"
                      : "border-white/10 bg-white/[0.03] text-content-muted hover:text-white",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-bold text-content-soft">زبان و صدا</p>
            <div className="grid grid-cols-2 gap-1.5">
              {AUDIOS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, audio: d.audio === a ? null : a }))}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-[10px] font-semibold transition-colors",
                    draft.audio === a
                      ? "border-amber-400/40 bg-amber-400/12 text-amber-200"
                      : "border-white/10 bg-white/[0.03] text-content-muted hover:text-white",
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 border-t border-white/[0.07] pt-4">
            <button
              type="button"
              onClick={() => setDraft({ ...baseFilters, sort: draft.sort })}
              className="btn btn-ghost btn-md flex-1"
            >
              <RotateCcw className="size-3.5" />
              پاک کردن
            </button>
            <button
              type="button"
              onClick={() => {
                setFilters(draft);
                setFilterOpen(false);
              }}
              className="btn btn-primary btn-md flex-[1.4]"
            >
              نمایش نتیجه‌ها
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
