"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpLeft, Compass, GitBranch } from "lucide-react";
import type { AnimeConnections as ConnectionsData, ConnectionCard } from "@/lib/anime-connections";
import { faDigits } from "@/lib/utils";

type TabKey = "relations" | "similar";
const TAB_LABELS: Record<TabKey, string> = { relations: "فصل‌ها و آثار مرتبط", similar: "انیمه‌های مشابه" };

const RELATIONS: Record<string, string> = {
  PREQUEL: "پیش‌درآمد", SEQUEL: "ادامه", SIDE_STORY: "داستان جانبی", SPIN_OFF: "اسپین‌آف",
  ALTERNATIVE: "روایت جایگزین", PARENT: "اثر مادر", SUMMARY: "خلاصه", CHARACTER: "حضور شخصیت",
  ADAPTATION: "اقتباس", SOURCE: "منبع اصلی", COMPILATION: "گردآوری", CONTAINS: "شامل", OTHER: "مرتبط",
};
const FORMATS: Record<string, string> = {
  TV: "TV", TV_SHORT: "TV کوتاه", MOVIE: "فیلم", SPECIAL: "ویژه", OVA: "OVA", ONA: "ONA",
  MUSIC: "موزیک", MANGA: "مانگا", NOVEL: "رمان", ONE_SHOT: "وان‌شات",
};
const TINTS = [
  ["#3b245c", "#181020", "#ffd05c"], ["#173c46", "#0e1c24", "#5ee4ff"],
  ["#452436", "#1b101a", "#ff8fbc"], ["#3c3418", "#1d190e", "#ffd05c"], ["#26305a", "#111425", "#93b3ff"],
];

/** Related cards may navigate only to a canonical local anime page. */
export function safeInternalHref(value?: string): value is string {
  return Boolean(value && /^\/anime\/[^/?#\\\s]+$/.test(value) && !/%(?:2f|5c|2e)/i.test(value));
}

export function safeExternalHref(value?: string): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function localConnectionCards(cards: ConnectionCard[]): ConnectionCard[] {
  return cards.filter(card => card.available && Boolean(card.slug) && card.href === `/anime/${card.slug}` && safeInternalHref(card.href));
}

/** Local artwork or a cover served by AniList; never an arbitrary remote image. */
export function safeCoverSrc(value?: string): string | null {
  if (value?.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u0020]/.test(value)) return value;
  if (!safeExternalHref(value)) return null;
  const host = new URL(value).hostname;
  return host === "anilist.co" || host.endsWith(".anilist.co") ? value : null;
}

export function connectionRelationLabel(card: ConnectionCard): string {
  if (!card.relation) return card.label;
  const key = card.relation.trim().toUpperCase().replace(/[-\s]+/g, "_");
  return RELATIONS[key] ?? card.label ?? card.relation;
}

export function connectionFormatLabel(format: string): string {
  const key = format.trim().toUpperCase().replace(/[-\s]+/g, "_");
  return FORMATS[key] ?? format.trim();
}

function tintFor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [from, to, accent] = TINTS[hash % TINTS.length];
  return { backgroundImage: `linear-gradient(155deg, ${from}, ${to})`, accent };
}

function CardShell({ card, children }: { card: ConnectionCard; children: React.ReactNode }) {
  const className = "group flex h-full min-w-0 gap-2.5 rounded-2xl border border-line bg-white/[0.035] p-2.5 transition-[transform,border-color,background-color] duration-200 ease-snap hover:border-amber-400/40 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 motion-safe:active:scale-[.995] motion-reduce:transition-none sm:gap-3 sm:p-3";
  const label = `${card.title} — ${card.titleEn}`;
  return <Link href={card.href} className={className} aria-label={label}>{children}</Link>;
}

function ConnectionPoster({ card }: { card: ConnectionCard }) {
  const tint = tintFor(card.id || card.slug || card.title);
  const cover = safeCoverSrc(card.cover);
  return (
    <div data-art-surface className="relative aspect-[17/24] w-[78px] shrink-0 overflow-hidden rounded-xl border border-white/15 bg-ink-800 sm:w-[88px]" style={cover ? undefined : { backgroundImage: tint.backgroundImage }}>
      <span aria-hidden className="absolute inset-0 opacity-70" style={{ backgroundImage: `radial-gradient(circle at 75% 12%, ${tint.accent}, transparent 68%)` }} />
      {cover ? (
        <img
          src={cover}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
           className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-snap motion-safe:group-hover:scale-[1.04] motion-reduce:transition-none"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      ) : (
        <span aria-hidden className="absolute inset-0 grid place-items-center text-white/25"><GitBranch className="size-5" /></span>
      )}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ink-950/80 to-transparent" />
    </div>
  );
}

function ConnectionCardView({ card, tab }: { card: ConnectionCard; tab: TabKey }) {
  const format = card.format ? connectionFormatLabel(card.format) : "";
  const genres = card.source === "genres";
  return (
    <li className="min-w-0 snap-start">
      <CardShell card={card}>
        <ConnectionPoster card={card} />
        <div className="flex min-w-0 flex-1 flex-col py-0.5">
          <div className="flex flex-wrap items-center gap-1">
            {tab === "relations" ? (
              <span className="rounded-md border border-gold-300/30 bg-gold-400/10 px-1.5 py-0.5 text-[9.5px] font-black text-gold-300">{connectionRelationLabel(card)}</span>
            ) : null}
            {format ? (
              <span dir="ltr" className="rounded-md border border-white/15 bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-content-soft">{format}</span>
            ) : null}
          </div>
          <h3 className="mt-1.5 line-clamp-2 text-[12.5px] font-extrabold leading-5 text-white">{card.title}</h3>
          {card.titleEn !== card.title ? <p dir="ltr" title={card.titleEn} className="mt-0.5 line-clamp-1 text-right text-[10.5px] font-medium leading-4 text-content-muted">{card.titleEn}</p> : null}
          {card.year !== null ? <p className="mt-1 text-[10px] font-semibold tabular-nums text-content-faint">سال {faDigits(card.year)}</p> : null}
          {genres && card.reason ? <p className="mt-1 line-clamp-2 text-[10.5px] leading-[1.7] text-content-muted">{card.reason}</p> : null}
          <div className="mt-auto flex items-center justify-between gap-2 pt-2">
            {genres ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-content-faint"><Compass aria-hidden className="size-3" />هم‌ژانر</span> : <span />}
            <ArrowUpLeft aria-hidden className="size-4 text-content-faint transition-transform motion-safe:group-hover:-translate-x-0.5 motion-reduce:transition-none" />
          </div>
        </div>
      </CardShell>
    </li>
  );
}

function EmptyState({ tab }: { tab: TabKey }) {
  return (
    <div className="empty-plate flex min-h-40 flex-col items-center justify-center rounded-2xl border border-line bg-white/[0.02] px-5 py-7 text-center">
      <span aria-hidden className="grid size-10 place-items-center rounded-full border border-gold-300/25 bg-gold-400/10 text-gold-300">
        {tab === "relations" ? <GitBranch className="size-[18px]" /> : <Compass className="size-[18px]" />}
      </span>
      <p className="mt-3 text-[12.5px] font-bold text-white">{tab === "relations" ? "انیمهٔ مرتبطی در سایت موجود نیست" : "انیمهٔ مشابهی در سایت پیدا نشد"}</p>
    </div>
  );
}

export function AnimeConnections({ connections }: { connections: ConnectionsData }) {
  const [tab, setTab] = useState<TabKey>("relations");
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const base = useId().replace(/:/g, "");
  const cards = { relations: localConnectionCards(connections.relations), similar: localConnectionCards(connections.similar) };
  const select = (next: TabKey) => {
    setTab(next);
    tabs.current[next === "relations" ? 0 : 1]?.focus();
  };
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowRight" ? (index === 0 ? 1 : 0) : -1;
    if (next < 0) return;
    event.preventDefault();
    select(next === 0 ? "relations" : "similar");
  };

  return (
    <section id="related" aria-label="انیمه‌های مرتبط و مشابه" className="shell section-pad scroll-mt-24 pb-10">
      <div className="glass relative overflow-hidden rounded-[28px] px-3 py-4 sm:px-6 sm:py-7">
        <div role="tablist" aria-label="ارتباط‌ها و پیشنهادها" className="connections-tabs relative grid w-full grid-cols-2 sm:max-w-md">
          {(Object.keys(TAB_LABELS) as TabKey[]).map((key, index) => {
            const selected = tab === key;
            return (
              <button
                key={key}
                ref={(node) => { tabs.current[index] = node; }}
                id={`connections-tab-${key}-${base}`}
                type="button"
                disabled={!interactive}
                role="tab"
                aria-selected={selected}
                aria-controls={`connections-panel-${key}-${base}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(key)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                className="connection-tab relative inline-flex min-h-12 min-w-0 items-center justify-center px-2 py-3 text-[12px] font-semibold sm:px-4 sm:text-[13px]"
              >
                <span className="truncate">{TAB_LABELS[key]}</span>
              </button>
            );
          })}
        </div>

        {(["relations", "similar"] as TabKey[]).map((key) => <div key={key} role="tabpanel" id={`connections-panel-${key}-${base}`} aria-labelledby={`connections-tab-${key}-${base}`} hidden={tab !== key} tabIndex={0} className="relative mt-4 outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60">
          {tab === key && (cards[key].length ? (
            <ul className="hide-scrollbar -mx-1 grid snap-x snap-mandatory grid-flow-col auto-cols-[minmax(252px,82%)] gap-2.5 overflow-x-auto overscroll-x-contain px-1 pb-2 sm:mx-0 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-2 sm:gap-3 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-3">
              {cards[key].map((card) => <ConnectionCardView key={`${card.id}-${card.href}`} card={card} tab={key} />)}
            </ul>
          ) : <EmptyState tab={key} />)}
        </div>)}

      </div>
    </section>
  );
}
