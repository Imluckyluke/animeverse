export type DownloadCacheReply = {
  job?: string;
  status: "waiting" | "queued" | "uploading" | "ready" | "failed" | "expired" | "deleting";
  url?: string;
  provider?: "github" | "telegram";
  bytes?: number;
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
  return isGitHubCacheUrl(value) || typeof value === "string" && /^https:\/\/t\.me\/testanivers\/[1-9]\d*$/.test(value);
}

/** Only an exact, ready public archive file can bypass GitHub preparation. */
export function telegramDownloadUrl(quality: { status?: string; url?: unknown }) {
  return quality.status === "done" && typeof quality.url === "string" && /^https:\/\/t\.me\/testanivers\/[1-9]\d*$/.test(quality.url) ? quality.url : undefined;
}
