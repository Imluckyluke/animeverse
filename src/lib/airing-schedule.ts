import type { Anime } from "./catalog";
import metadataFile from "./generated-metadata.json";
import airingFile from "./generated-airing.json";

/** Server-published next episode, in UTC ISO form; the UI converts to Tehran. */
export type UpcomingEpisode = {
  episode: number;
  airingAt: string;
  source: "anilist";
};

type MetadataFile = {
  metadata?: Record<string, {
    identity?: { titleEn?: string; titleJa?: string };
    providerId?: number;
    data?: { year?: number };
  }>;
};

type SourceIdentity = { titleEn?: string; titleJa?: string; year?: number };
type AiringIdentity = {
  providerId?: number;
  type?: string;
  status?: string;
  format?: string;
  year?: number;
};
type AiringEntry = {
  checkedAt?: string;
  identity?: AiringIdentity;
  sources?: SourceIdentity[];
  nextAiringEpisode?: { airingAt?: unknown; episode?: unknown };
};
type AiringFile = { entries?: Record<string, AiringEntry> };

const metadata = (metadataFile as MetadataFile).metadata ?? {};
const airingEntries = (airingFile as AiringFile).entries ?? {};

const FRESH_MS = 6 * 60 * 60 * 1000;
const MAX_AIRING_MS = Date.UTC(2100, 0, 1);
const STATUSES = new Set(["RELEASING", "NOT_YET_RELEASED"]);
const FORMATS = new Set(["TV", "TV_SHORT", "MOVIE", "SPECIAL", "OVA", "ONA", "MUSIC"]);
const BLOCKED_FORMATS = new Set(["MOVIE", "OVA", "MUSIC"]);
const SERIAL_FORMATS = new Set(["TV", "TV_SHORT", "ONA", "SPECIAL"]);
const ANILIST_URL = /^https:\/\/anilist\.co\/anime\/([1-9][0-9]{0,9})\/?$/;

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function metadataProviderId(anime: Anime): number | null {
  const entry = metadata[anime.slug];
  if (!entry) return null;
  if (entry.identity?.titleEn !== anime.titleEn) return null;
  if ((entry.identity?.titleJa ?? "") !== (anime.titleJa ?? "")) return null;
  if (anime.year && entry.data?.year && anime.year !== entry.data.year) return null;
  return positiveId(entry.providerId);
}

function providerId(anime: Anime): number | null {
  const fromMetadata = metadataProviderId(anime);
  const match = anime.metadataSource === "anilist" ? ANILIST_URL.exec(anime.metadataUrl ?? "") : null;
  const fromUrl = match ? positiveId(Number(match[1])) : null;
  if (fromMetadata && fromUrl && fromMetadata !== fromUrl) return null;
  return fromMetadata ?? fromUrl;
}

function sourceMatches(anime: Anime, source: SourceIdentity): boolean {
  return source.titleEn === anime.titleEn
    && (source.titleJa ?? "") === (anime.titleJa ?? "")
    && (Number(source.year) || 0) === (Number(anime.year) || 0);
}

function compatibleIdentity(anime: Anime, identity: AiringIdentity): boolean {
  const status = typeof identity.status === "string" ? identity.status : "";
  if (!STATUSES.has(status)) return false;
  const format = typeof identity.format === "string" ? identity.format : "";
  if (!FORMATS.has(format) || BLOCKED_FORMATS.has(format)) return false;
  if (anime.year && identity.year && anime.year !== identity.year) return false;

  const localFormat = anime.format && anime.format !== "نامشخص" ? anime.format : "";
  if (localFormat && localFormat !== format) return false;
  if (anime.type === "فیلم" && format !== "MOVIE") return false;
  if (anime.type === "OVA" && format !== "OVA") return false;
  if (anime.type === "سریال" && !SERIAL_FORMATS.has(format)) return false;
  return true;
}

function airingTimestamp(value: unknown): number | null {
  let stamp: number;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return null;
    stamp = value * 1000;
  } else if (typeof value === "string" && value) {
    stamp = Date.parse(value);
  } else {
    return null;
  }
  return Number.isFinite(stamp) && stamp > 0 && stamp <= MAX_AIRING_MS ? stamp : null;
}

export function getNextAiringEpisode(anime: Anime, now = Date.now()): UpcomingEpisode | null {
  const id = providerId(anime);
  if (!id) return null;
  const entry = airingEntries[String(id)];
  if (!isRecord(entry) || !isRecord(entry.identity)) return null;
  if (positiveId(entry.identity.providerId) !== id || entry.identity.type !== "ANIME") return null;
  if (!compatibleIdentity(anime, entry.identity)) return null;

  // Exact local snapshots only. A changed title, roman season or year fails closed.
  if (!Array.isArray(entry.sources) || entry.sources.length === 0) return null;
  if (!entry.sources.some(source => isRecord(source) && sourceMatches(anime, source))) return null;

  const checked = typeof entry.checkedAt === "string" ? Date.parse(entry.checkedAt) : Number.NaN;
  if (!Number.isFinite(checked) || checked > now || now - checked >= FRESH_MS) return null;

  const upcoming = entry.nextAiringEpisode;
  if (!isRecord(upcoming)) return null;
  const episode = upcoming.episode;
  if (typeof episode !== "number" || !Number.isSafeInteger(episode) || episode <= 0) return null;
  const stamp = airingTimestamp(upcoming.airingAt);
  if (stamp === null || stamp <= now) return null;

  return { episode, airingAt: new Date(stamp).toISOString(), source: "anilist" };
}
