import { validDownloadTarget, type DownloadCacheReply } from "./download-cache-contract";

export const DOWNLOAD_STORAGE = "av_downloads_v1";
export type EpisodeTransfer = Omit<DownloadCacheReply, "status"> & {
  episode: number; quality: string;
  status: DownloadCacheReply["status"] | "registering" | "checking";
};
export type DownloadRecord = {
  id: string; slug: string; title: string; quality: string; episode?: number;
  all: boolean; createdAt: number; updatedAt: number; serverId?: string;
  items: EpisodeTransfer[]; total: number; error?: string;
};
export type DownloadSelection = { slug: string; title: string; episode: number; quality: string; size?: number | null };
export type BulkSelection = { slug: string; title: string; qualities: { label: string; count: number }[]; total: number };
export const transferActive = (item: EpisodeTransfer) => ["registering", "checking", "waiting", "queued", "uploading", "deleting"].includes(item.status);

/** Stable row identities keep unchanged waiting episodes out of React paints. */
export function reconcileTransfers(previous: EpisodeTransfer[], incoming: EpisodeTransfer[]) {
  const old = new Map(previous.map(item => [item.episode + "|" + item.quality, item]));
  const fields = ["job", "status", "bytes", "size", "url", "provider", "bucket", "error"] as const;
  const next = incoming.map(item => {
    const existing = old.get(item.episode + "|" + item.quality);
    return existing && fields.every(field => existing[field] === item[field]) ? existing : item;
  });
  return next.length === previous.length && next.every((item, index) => item === previous[index]) ? previous : next;
}

export function persistableDownloadHistory(records: DownloadRecord[]) {
  // A durable server batch owns the full list. Keep its ID plus a small preview
  // locally rather than stringify thousands of rows during a popup transition.
  return records.map(row => row.all && row.serverId && row.items.length > 20 ? { ...row, items: row.items.slice(0, 20) } : row);
}

export function parseDownloadHistory(value: string | null, recheck = true): DownloadRecord[] {
  try {
    const data: unknown = JSON.parse(value || "[]");
    if (!Array.isArray(data)) return [];
    return data.slice(0, 200).flatMap(raw => {
      if (!raw || typeof raw !== "object") return [];
      const row = raw as DownloadRecord;
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(row.id || "") || typeof row.slug !== "string" || !/^[a-z0-9-]{1,240}$/.test(row.slug) || typeof row.title !== "string" || typeof row.quality !== "string" || !Number.isFinite(row.createdAt) || !Array.isArray(row.items)) return [];
      const items = row.items.slice(0, 2000).flatMap(item => {
        if (!item || !Number.isInteger(item.episode) || item.episode <= 0 || typeof item.quality !== "string" || !["waiting","queued","uploading","ready","failed","expired","deleting","registering","checking"].includes(item.status)) return [];
        return [{ ...item, bytes: typeof item.bytes === "number" && Number.isFinite(item.bytes) ? Math.max(0,item.bytes) : 0, size: typeof item.size === "number" && Number.isFinite(item.size) && item.size > 0 ? item.size : undefined, error: typeof item.error === "string" ? item.error.slice(0,1200) : undefined, url: validDownloadTarget(item.url) ? item.url : undefined, status: recheck && item.status === "ready" ? "checking" as const : item.status }];
      });
      if (!row.all && (!Number.isInteger(row.episode) || row.episode! <= 0)) return [];
      return [{ ...row, error: typeof row.error === "string" ? row.error.slice(0,1200) : undefined, title: row.title.slice(0, 400), quality: row.quality.slice(0, 50), all: row.all === true, serverId: /^[a-f0-9]{64}$/.test(row.serverId || "") ? row.serverId : undefined, total: Math.max(items.length, Math.min(2000, Number(row.total) || 1)), items }];
    });
  } catch { return []; }
}

export function mergeDownloadHistory(left: DownloadRecord[], right: DownloadRecord[]) {
  const result = new Map(left.map(row => [row.id, row]));
  for (const row of right) {
    const previous = result.get(row.id);
    if (previous && row.updatedAt <= previous.updatedAt) continue;
    if (previous && row.serverId === previous.serverId && row.items.length < row.total && previous.items.length > row.items.length) {
      const preview = new Map(row.items.map(item => [item.episode + "|" + item.quality, item]));
      result.set(row.id, { ...row, items: previous.items.map(item => preview.get(item.episode + "|" + item.quality) || item) });
    } else result.set(row.id, row);
  }
  return [...result.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function progressPercent(item: EpisodeTransfer) {
  if (item.status === "ready") return 100;
  return item.size && item.size > 0 ? Math.max(0, Math.min(99, Math.floor((item.bytes || 0) / item.size * 100))) : 0;
}
