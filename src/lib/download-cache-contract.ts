export type DownloadCacheReply = {
  job?: string;
  status: "waiting" | "queued" | "uploading" | "ready" | "failed" | "expired" | "deleting";
  url?: string;
  provider?: "github" | "telegram" | "local";
  phase?: "metadata" | "receiving" | "waiting_data" | "verifying" | "capacity" | "cooldown" | "paused" | "queued" | "waiting" | "uploading" | "ready" | "failed" | "expired" | "deleting";
  speed?: number;
  percent?: number;
  etaSeconds?: number | null;
  queueAhead?: number;
  updatedAt?: number | null;
  retryAt?: number | null;
  bytes?: number;
  streamBytes?: number;
  live?: boolean;
  size?: number;
  retryAfter?: number;
  bucket?: "hot" | "temp";
  error?: string;
};

export type DownloadBatchReply = {
  batch: string; slug: string; quality: string; total: number;
  status: "ready" | "queued";
  items: (DownloadCacheReply & { episode: number; quality: string })[];
};

export function isGitHubCacheUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password && !url.port &&
      /^\/itisluckyluke-dev\/animeverse-(?:popular|temporary)-downloads\/releases\/download\/[^/]+\/[^/]+$/.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}

export function validDownloadTarget(value: unknown): value is string {
  return isCacheDownloadUrl(value) || typeof value === "string" && /^https:\/\/t\.me\/testanivers\/[1-9]\d*$/.test(value);
}

/** Only an exact, ready public archive file can bypass GitHub preparation. */
export function telegramDownloadUrl(quality: { status?: string; url?: unknown }) {
  return quality.status === "done" && typeof quality.url === "string" && /^https:\/\/t\.me\/testanivers\/[1-9]\d*$/.test(quality.url) ? quality.url : undefined;
}

export function isLocalCacheUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "anime.bayerkashan.ir" &&
      !url.username && !url.password && !url.port && !url.search && !url.hash &&
      /^\/media\/[a-f0-9]{64}\/[a-f0-9]{32}\/[0-9]{10}\/[a-f0-9]{64}$/.test(url.pathname);
  } catch { return false; }
}

export function isCacheDownloadUrl(value: unknown): value is string {
  return isGitHubCacheUrl(value) || isLocalCacheUrl(value);
}

const downloadStatuses = new Set<DownloadCacheReply["status"]>(["waiting", "queued", "uploading", "ready", "failed", "expired", "deleting"]);
const downloadProviders = new Set<NonNullable<DownloadCacheReply["provider"]>>(["github", "telegram", "local"]);

export function validStreamBytes(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Validate every reply field that can become a browser navigation target.
 * A live reply is deliberately narrow: it is an in-progress local upstream
 * transfer, never a completed file and never a GitHub/Telegram URL. */
export function isSafeDownloadReply(value: unknown): value is DownloadCacheReply {
  if (!value || typeof value !== "object") return false;
  const item = value as DownloadCacheReply;
  if (!downloadStatuses.has(item.status)) return false;
  if (item.provider !== undefined && !downloadProviders.has(item.provider)) return false;
  if (item.url !== undefined && !validDownloadTarget(item.url)) return false;
  if (item.status === "ready" && !validDownloadTarget(item.url)) return false;
  if (item.live !== undefined && typeof item.live !== "boolean") return false;
  if (item.streamBytes !== undefined && !validStreamBytes(item.streamBytes)) return false;
  if (item.live === true) {
    if (item.status !== "uploading" || item.provider !== "local" || !isLocalCacheUrl(item.url)) return false;
    if (item.streamBytes === undefined || typeof item.size !== "number" || !Number.isSafeInteger(item.size) || item.size <= 0 || item.streamBytes >= item.size) return false;
    if (item.bytes !== undefined && (typeof item.bytes !== "number" || !Number.isSafeInteger(item.bytes) || item.bytes < item.streamBytes || item.bytes > item.size)) return false;
  } else if (item.streamBytes !== undefined) {
    return false;
  }
  return true;
}
