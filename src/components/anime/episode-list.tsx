"use client";

import { ChevronDown, Download, Eye, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/app-context";
import type { Anime, Episode } from "@/lib/catalog";
import { getEpisodes } from "@/lib/catalog";
import { cn, faBytes, faDate, faDigits, faScore, openRealDownload, triggerDownload } from "@/lib/utils";

const PREVIEW_COUNT = 6;
const EXTRA_BATCH = 24;

type LiveQuality = { status: "done" | "pending" | "failed"; size?: number | null };

function sizeLabel(quality: string, episode: number): string {
  if (quality === "4K") return `${faScore(4 + (episode % 5) / 10)} گیگابایت`;
  if (quality === "1080p") return `${faScore(1.3 + (episode % 6) / 10)} گیگابایت`;
  if (quality === "720p") return `${faDigits(720 + (episode % 9) * 10)} مگابایت`;
  return `${faDigits(390 + (episode % 7) * 10)} مگابایت`;
}

export function EpisodeList({ anime }: { anime: Anime }) {
  const episodes = getEpisodes(anime);
  const { toast, markWatched, isWatched, lastWatched } = useApp();
  const [sheet, setSheet] = useState<Episode | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [renderedExtra, setRenderedExtra] = useState(0);
  const [loadingQuality, setLoadingQuality] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, LiveQuality>>({});
  const lastSeen = lastWatched(anime.slug);
  const isReal = anime.source === "aniplus";
  const hidden = Math.max(episodes.length - PREVIEW_COUNT, 0);
  const preview = episodes.slice(0, PREVIEW_COUNT);
  // Long-running shows (Detective Conan and similar) can have hundreds of
  // episodes. Render the expanded list in batches so the page stays light.
  const extraShown = Math.min(hidden, Math.max(renderedExtra, EXTRA_BATCH));
  const extra = expanded ? episodes.slice(PREVIEW_COUNT, PREVIEW_COUNT + extraShown) : [];
  const remaining = Math.max(hidden - extra.length, 0);
  const extraRef = useRef<HTMLDivElement>(null);

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
          const status: LiveQuality["status"] =
            response.ok && payload?.url
              ? "done"
              : payload?.status === "failed"
                ? "failed"
                : "pending";
          return [`${episode}|${label}`, { status, size: payload?.size ?? null }] as const;
        } catch {
          return null;
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

  const download = (episode: number, q: string) => {
    if (isReal) {
      const run = async () => {
        setLoadingQuality(q);
        markWatched(anime.slug, episode);
        const result = await openRealDownload(anime.slug, episode, q);
        setLoadingQuality(null);
        if (result === "done") {
          toast("لینک آماده شد", `${anime.titleEn} — قسمت ${faDigits(episode)} · ${q}`);
          setSheet(null);
        } else if (result === "pending") {
          toast("در حال آماده‌سازی", "این کیفیت هنوز روی کانال قرار نگرفته؛ کمی بعد دوباره امتحان کن.");
        } else {
          toast("لینک آماده نیست", "لینک این کیفیت آماده نشد؛ بعداً دوباره تلاش کن.");
        }
      };
      void run();
      return;
    }
    markWatched(anime.slug, episode);
    triggerDownload(anime.slug, episode, q);
    toast("دانلود آغاز شد", `${anime.titleEn} — قسمت ${faDigits(episode)} · ${q}`);
  };

  const openQuality = (ep: Episode) => {
    const labels = ep.qualities?.map((quality) => quality.label) ?? anime.quality;
    if (labels.length === 1) {
      download(ep.number, labels[0]);
      return;
    }
    setSheet(ep);
  };

  const renderEpisode = (ep: Episode) => {
    const seen = isWatched(anime.slug, ep.number);
    const latest = seen && lastSeen === ep.number;
    const isOpen = sheet?.number === ep.number;
    const labels = ep.qualities?.length
      ? ep.qualities
      : anime.quality.map((label) => ({ label, status: undefined, size: undefined }));

    return (
      <div key={ep.number} role="listitem" className="relative pb-2 ps-9 last:pb-0">
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
          className={cn(
            "overflow-hidden rounded-2xl border transition-colors duration-300",
            isOpen
              ? "border-amber-400/30 bg-amber-400/[0.05]"
              : "border-white/[0.08] bg-white/[0.02] hover:border-white/20",
          )}
        >
          <button
            type="button"
            onClick={() => setSheet(isOpen ? null : ep)}
            aria-expanded={isOpen}
            className="flex w-full items-center gap-3 px-3 py-3 text-right"
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
              <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10.5px] text-content-faint">
                <span>{ep.runtime}</span>
                <span className="hidden sm:inline">· {faDate(ep.releasedAt)}</span>
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

          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
              isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="overflow-hidden">
              <div className="flex flex-wrap gap-2 border-t border-white/[0.07] px-3 py-3">
                {labels.map((quality) => {
                  const busy = loadingQuality === quality.label;
                  const liveQuality = isReal ? live[`${ep.number}|${quality.label}`] : undefined;
                  const done = (liveQuality?.status ?? quality.status) === "done";
                  const failed = (liveQuality?.status ?? quality.status) === "failed";
                  const size = liveQuality?.size ?? quality.size;
                  return (
                    <button
                      key={quality.label}
                      type="button"
                      disabled={loadingQuality !== null}
                      onClick={() => {
                        download(ep.number, quality.label);
                        if (!isReal) setSheet(null);
                      }}
                      className="flex items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.05] px-2.5 py-1.5 transition-colors hover:border-amber-400/45 hover:bg-amber-400/10 disabled:opacity-60"
                    >
                      {busy ? (
                        <Loader2 className="size-3 animate-spin text-amber-300" />
                      ) : (
                        <Download className="size-3 text-amber-300" />
                      )}
                      <span dir="ltr" className="text-[10.5px] font-bold text-white/85">
                        {quality.label}
                      </span>
                      <span
                        className={cn(
                          "text-[9.5px]",
                          failed ? "text-rose-300" : done ? "text-emerald-300/90" : "text-white/40",
                        )}
                      >
                        {isReal
                          ? size
                            ? faBytes(size)
                            : failed
                              ? "ناموفق"
                              : done
                                ? "آماده"
                                : "در صف"
                          : sizeLabel(quality.label, ep.number)}
                      </span>
                    </button>
                  );
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
      setExpanded(false);
      setRenderedExtra(0);
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
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <h2 className="headline text-xl sm:text-2xl">قسمت‌ها</h2>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-bold text-content-muted">
          {faDigits(episodes.length)} قسمت
        </span>
        {lastSeen ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-200">
            <Eye className="size-3" />
            آخرین قسمت مشاهده‌شده: {faDigits(lastSeen)}
          </span>
        ) : null}
      </div>

      <div className="relative" role="list" aria-label="قسمت‌ها">
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
  );
}
