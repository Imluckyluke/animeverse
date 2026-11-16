"use client";

import { Check, ChevronDown, Download, Eye, EyeOff, Layers3, Send } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useApp } from "@/lib/app-context";
import type { Anime, Episode } from "@/lib/catalog";
import { getEpisodes } from "@/lib/catalog";
import { cn, faBytes, faDate, faDigits } from "@/lib/utils";
import { useDownloadActions } from "@/components/downloads/downloads-provider";
import { telegramDownloadUrl } from "@/lib/download-cache-contract";
import { DownloadMethodTabs, type DownloadMethod } from "./download-method-tabs";

const PREVIEW_COUNT = 6;
const EXTRA_BATCH = 24;

type LiveQuality = { status: "done" | "pending" | "failed" | "unknown"; size?: number | null; url?: string };

export function EpisodeList({ anime }: { anime: Anime }) {
  const episodes = getEpisodes(anime);
  const { toggleWatched, isWatched, lastWatched } = useApp();
  const { startDownload, chooseBulk } = useDownloadActions();
  const [jumpTarget, setJumpTarget] = useState<number | null>(null);
  const [sheet, setSheet] = useState<Episode | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [renderedExtra, setRenderedExtra] = useState(0);
  const [live, setLive] = useState<Record<string, LiveQuality>>({});
  const [method, setMethod] = useState<DownloadMethod>("github");
  const methodId = useId();
  const lastSeen = lastWatched(anime.slug);
  const isReal = anime.source === "aniplus" || anime.source === "archive";
  const hidden = Math.max(episodes.length - PREVIEW_COUNT, 0);
  const preview = episodes.slice(0, PREVIEW_COUNT);
  // Long-running shows (Detective Conan and similar) can have hundreds of
  // episodes. Render the expanded list in batches so the page stays light.
  const extraShown = Math.min(hidden, Math.max(renderedExtra, EXTRA_BATCH));
  const extra = renderedExtra > 0 ? episodes.slice(PREVIEW_COUNT, PREVIEW_COUNT + extraShown) : [];
  const remaining = Math.max(hidden - extra.length, 0);
  const extraRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reveal = (number: number) => {
      const index = episodes.findIndex(episode => episode.number === number);
      if (index < 0) return;
      if (index >= PREVIEW_COUNT) {
        setExpanded(true);
        setRenderedExtra(Math.max(EXTRA_BATCH, index - PREVIEW_COUNT + 1));
      }
      setSheet(episodes[index]);
      setJumpTarget(number);
    };
    const fromHash = () => {
      const prefix = `#episode-${anime.slug}-`;
      if (location.hash.startsWith(prefix)) reveal(Number(location.hash.slice(prefix.length)));
    };
    const fromAction = (event: Event) => {
      const detail = (event as CustomEvent<{ slug: string; number: number }>).detail;
      if (detail?.slug === anime.slug) reveal(detail.number);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    window.addEventListener("av-episode-jump", fromAction);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener("av-episode-jump", fromAction);
    };
  // Episode metadata is immutable for this mounted title. Do not reopen a row
  // on every progress update or local interaction.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anime.slug]);

  useEffect(() => {
    if (jumpTarget === null) return;
    const row = document.getElementById(`episode-${anime.slug}-${jumpTarget}`);
    if (row) {
      row.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      row.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      setJumpTarget(null);
    }
  }, [jumpTarget, expanded, renderedExtra, anime.slug]);

  const jumpToLastSeen = () => {
    const index = episodes.findIndex((episode) => episode.number === lastSeen);
    if (index < 0 || lastSeen === null) return;
    if (index >= PREVIEW_COUNT) {
      setExpanded(true);
      setRenderedExtra(Math.max(EXTRA_BATCH, index - PREVIEW_COUNT + 1));
    }
    setSheet(episodes[index]);
    setJumpTarget(lastSeen);
  };

  useEffect(() => {
    if (extraRef.current) {
      (extraRef.current as HTMLDivElement & { inert: boolean }).inert = !expanded;
    }
  }, [expanded]);

  useEffect(() => {
    if (!isReal || !sheet) return;
    const episode = sheet.number;
    const labels = sheet.qualities?.map((quality) => quality.label) ?? anime.quality;
    const controller = new AbortController();
    setLive({});
    const queryFor = (label: string) =>
      new URLSearchParams({ slug: anime.slug, ep: String(episode), q: label }).toString();
    void Promise.all(
      labels.map(async (label) => {
        try {
          const response = await fetch(`/api/link?${queryFor(label)}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          const payload = (await response.json().catch(() => null)) as {
            url?: string;
            status?: string;
            size?: number | null;
          } | null;
          const url = telegramDownloadUrl({ status: "done", url: payload?.url });
          const status: LiveQuality["status"] =
            response.ok && url
              ? "done"
              : payload?.status === "failed"
                ? "failed"
                : response.status === 202 || payload?.status === "pending" ? "pending" : "unknown";
          return [`${episode}|${label}`, { status, size: payload?.size ?? null, url: status === "done" ? url : undefined }] as const;
        } catch {
          return [`${episode}|${label}`, { status: "unknown" as const }] as const;
        }
      }),
    ).then((rows) => {
      if (controller.signal.aborted) return;
      const next: Record<string, LiveQuality> = {};
      for (const row of rows) if (row) next[row[0]] = row[1];
      setLive(next);
    });
    return () => controller.abort();
  }, [sheet, isReal, anime.slug, anime.quality]);

  const download = (episode: number, quality: string) => startDownload({ slug: anime.slug, title: anime.titleEn, episode, quality, size: episodes.find(ep => ep.number === episode)?.qualities?.find(q => q.label === quality)?.size }, { autoStart: true });
  const qualityEpisodes = new Map<string, Set<number>>();
  for (const ep of episodes) for (const quality of ep.qualities || []) {
    if (quality.status !== "done" || !/^https?:\/\//i.test(quality.url || "") || (quality.size || 0) >= 2 ** 31) continue;
    const set = qualityEpisodes.get(quality.label) || new Set<number>(); set.add(ep.number); qualityEpisodes.set(quality.label, set);
  }
  useEffect(() => {
    const url = new URL(window.location.href);
    const episode = Number(url.searchParams.get("download")), quality = url.searchParams.get("q");
    if (!episode || !quality || !anime.episodeData?.some(ep => ep.number === episode && ep.qualities.some(q => q.label === quality && q.status === "done"))) return;
    startDownload({ slug: anime.slug, title: anime.titleEn, episode, quality }, { autoStart: false });
    url.searchParams.delete("download"); url.searchParams.delete("q"); history.replaceState(history.state, "", url);
  }, [anime.slug, anime.titleEn, anime.episodeData, startDownload]);

  const renderEpisode = (ep: Episode) => {
    const seen = isWatched(anime.slug, ep.number);
    const latest = seen && lastSeen === ep.number;
    const isOpen = sheet?.number === ep.number;
    const labels = ep.qualities?.length
      ? ep.qualities
      : anime.quality.map((label) => ({ label, status: undefined, size: undefined }));

    return (
      <div key={ep.number} id={`episode-${anime.slug}-${ep.number}`} role="listitem" className="relative scroll-mt-24 pb-2 ps-9 last:pb-0">
        <span
          aria-hidden
          className={cn(
            "absolute right-[16px] top-[26px] z-10 size-[11px] rounded-full border-2 transition-colors duration-300",
            isOpen || seen
              ? "border-amber-300 bg-amber-300 shadow-[0_0_0_4px_rgba(255,183,0,.15)]"
              : "border-white/25 bg-[#0b0b11]",
          )}
        />

        <div
          data-open={isOpen}
          className={cn(
            "episode-row overflow-hidden rounded-2xl border transition-colors duration-300",
            isOpen
              ? "border-amber-400/30 bg-amber-400/[0.05]"
              : "border-white/[0.08] bg-white/[0.02] hover:border-white/20",
          )}
        >
          <div className="flex items-center pe-2">
          <button
            type="button"
            onClick={() => setSheet(isOpen ? null : ep)}
            aria-expanded={isOpen}
            aria-controls={`qualities-${anime.slug}-${ep.number}`}
            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-right"
          >
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-xl border text-[11px] font-black tabular-nums transition-colors",
                isOpen
                  ? "border-amber-400/40 bg-amber-400/15 text-amber-200"
                  : seen
                    ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
                    : "border-white/10 bg-white/[0.04] text-white/60",
                ep.number >= 1000 && "text-[9px]",
              )}
            >
              {faDigits(String(ep.number).padStart(2, "0"))}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-bold text-white">
                قسمت {faDigits(ep.number)}
                {ep.title ? (
                  <span className="font-medium text-content-soft"> — {ep.title}</span>
                ) : null}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-content-muted">
                {ep.runtime ? <span>{ep.runtime}</span> : null}
                {ep.releasedAt && faDate(ep.releasedAt) ? <span className="hidden sm:inline">· {faDate(ep.releasedAt)}</span> : null}
                {seen ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-amber-300/85">
                    <Eye className="size-3" />
                    {latest ? "آخرین قسمت مشاهده‌شده" : "مشاهده شده"}
                  </span>
                ) : null}
              </span>
            </span>

            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-white/40 transition-transform duration-300",
                isOpen && "rotate-180 text-amber-300",
              )}
            />
          </button>
          <button type="button" aria-pressed={seen} onClick={() => toggleWatched(anime.slug, ep.number)}
            aria-label={`${seen ? "برداشتن علامت مشاهده از" : "علامت‌زدن به‌عنوان مشاهده‌شده:"} قسمت ${faDigits(ep.number)}`}
            title={seen ? "مشاهده شده؛ برای لغو بزن" : "قسمت را دیده‌ام"}
            className={cn("grid size-11 shrink-0 place-items-center rounded-xl border transition-colors", seen ? "border-amber-400/30 bg-amber-400/10 text-amber-300" : "border-white/10 text-content-muted hover:text-white")}>
            {seen ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </button>
          </div>

          <div
            id={`qualities-${anime.slug}-${ep.number}`}
            aria-hidden={!isOpen}
            ref={(node) => { node?.toggleAttribute("inert", !isOpen); }}
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
              isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="overflow-hidden">
              <div key={method} className="episode-quality-actions flex flex-wrap gap-2 border-t border-white/[0.07] px-3 py-3">
                {labels.map((quality) => {
                  const liveQuality = isReal ? live[`${ep.number}|${quality.label}`] : undefined;
                  const done = liveQuality ? liveQuality.status === "done" : quality.status === "done" && /^https?:\/\//i.test(quality.url ?? "");
                  const failed = (liveQuality?.status ?? quality.status) === "failed";
                  const size = liveQuality?.size ?? quality.size;
                  const telegramUrl = telegramDownloadUrl(liveQuality && liveQuality.status !== "unknown" ? liveQuality : quality);
                  const className = "relative flex min-h-11 min-w-0 flex-wrap items-center gap-2 overflow-hidden rounded-xl border border-white/[0.12] bg-white/[0.05] px-3 py-2 transition-colors hover:border-amber-400/45 hover:bg-amber-400/10 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300";
                  const content = <>
                      {method === "telegram" ? <Send className="size-3.5 text-amber-300" aria-hidden /> : done ? <Check className="size-3 text-emerald-300" /> : <Download className="size-3 text-amber-300" />}
                      <span dir="ltr" className="text-xs font-bold text-white/85">
                        {quality.label}
                      </span>
                      <span
                        className={cn(
                          "text-xs",
                          failed ? "text-rose-300" : done ? "text-emerald-300/90" : "text-white/40",
                        )}
                      >
                        {isReal
                          ? failed ? "ناموفق" : done ? "آماده" : liveQuality?.status === "unknown" ? "بررسی نشد" : "در صف"
                          : "نمونه"}
                      </span>
                      {size ? <span className="text-xs text-content-muted">· {faBytes(size)}</span> : null}
                  </>;
                  return method === "github" ? <button key={quality.label} type="button"
                    aria-label={`دانلود مستقیم قسمت ${faDigits(ep.number)} با کیفیت ${quality.label}`}
                    onClick={() => download(ep.number, quality.label)} className={className}>{content}</button>
                    : telegramUrl ? <a key={quality.label} href={telegramUrl} target="_blank" rel="noopener noreferrer"
                      aria-label={`دانلود قسمت ${faDigits(ep.number)} با کیفیت ${quality.label} از تلگرام`} className={className}>{content}</a>
                    : <button key={quality.label} type="button" disabled className={className}
                      aria-label={`فایل تلگرام قسمت ${faDigits(ep.number)} با کیفیت ${quality.label} در دسترس نیست`}>{content}</button>;
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const toggleExpanded = () => {
    if (expanded) {
      setSheet(null);
      setExpanded(false);
    } else {
      setRenderedExtra(EXTRA_BATCH);
      setExpanded(true);
    }
  };

  const loadMore = () => {
    setRenderedExtra((count) => Math.min(hidden, Math.max(count, EXTRA_BATCH) + EXTRA_BATCH));
  };

  return (
    <div>
      <div id={`${methodId}-panel`} role="region" aria-label="قسمت‌های قابل دانلود">
      <div className="mb-5 flex min-h-11 flex-wrap items-center gap-2.5">
        <h2 className="headline text-xl sm:text-2xl">قسمت‌ها</h2>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-bold text-content-muted">
          {faDigits(episodes.length)} قسمت
        </span>
        <DownloadMethodTabs id={methodId} value={method} onChange={setMethod} />
        {method === "github" && qualityEpisodes.size > 0 && <button type="button" aria-label="دانلود همهٔ قسمت‌ها" title="دانلود همهٔ قسمت‌ها" className="btn btn-glass min-h-10 gap-1.5 rounded-xl px-2.5 text-[11px]" onClick={() => chooseBulk({ slug: anime.slug, title: anime.titleEn, total: episodes.length, qualities: [...qualityEpisodes].map(([label, numbers]) => ({ label, count: numbers.size })) })}><Layers3 className="size-3.5" />همه</button>}
        {lastSeen ? (
          <button type="button" onClick={jumpToLastSeen} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-200">
            <Eye className="size-3" />
            رفتن به آخرین قسمت مشاهده‌شده: {faDigits(lastSeen)}
          </button>
        ) : null}
      </div>

      <div className="relative" role="list" aria-label="قسمت‌ها">
        {!episodes.length ? <p className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 text-sm leading-7 text-content-muted">هنوز قسمتی از این عنوان در منابع ثبت نشده است.</p> : null}
        <span
          aria-hidden
          className="absolute inset-y-4 right-[21px] w-px bg-white/[0.10]"
        />
        {preview.map((ep) => renderEpisode(ep))}

        {hidden > 0 ? (
          <div
            ref={extraRef}
            id="episode-list-extra"
            aria-hidden={!expanded}
            className={cn(
              "grid transition-[grid-template-rows] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <div className="min-h-0 overflow-hidden [contain:paint]">
              <div
                className={cn(
                  "transition-opacity duration-300 ease-out",
                  expanded ? "opacity-100" : "opacity-0",
                )}
              >
                {extra.map((ep) => renderEpisode(ep))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {hidden > 0 ? (
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          aria-controls="episode-list-extra"
          className="btn btn-glass btn-md mt-4 w-full"
        >
          {expanded ? "بستن لیست" : `نمایش ${faDigits(hidden)} قسمت دیگر`}
          <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
        </button>
      ) : null}
      {expanded && remaining > 0 ? (
        <button
          type="button"
          onClick={loadMore}
          className="btn btn-glass btn-sm mt-2 w-full text-[11px]"
        >
          نمایش {faDigits(Math.min(EXTRA_BATCH, remaining))} قسمت دیگر
          <ChevronDown className="size-3.5" />
        </button>
      ) : null}
      </div>
    </div>
  );
}
