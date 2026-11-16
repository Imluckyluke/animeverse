import { isSafeDownloadReply, validDownloadTarget, type DownloadCacheReply } from "./download-cache-contract";

export const DOWNLOAD_STORAGE = "av_downloads_v1";
export type EpisodeTransfer = Omit<DownloadCacheReply, "status"> & {
  episode: number; quality: string;
  status: DownloadCacheReply["status"] | "registering" | "checking";
};
export type DownloadRecord = {
  id: string; slug: string; title: string; quality: string; episode?: number;
  all: boolean; createdAt: number; updatedAt: number; serverId?: string;
  items: EpisodeTransfer[]; total: number; error?: string;
  paused?: boolean; control?: "pause" | "resume";
  itemPaused?: Record<string, boolean>;
  itemControls?: Record<string, { action: "pause" | "resume"; job: string }>;
  removedItems?: Record<string, number>;
};
export type DownloadSelection = { slug: string; title: string; episode: number; quality: string; size?: number | null };
export type BulkSelection = { slug: string; title: string; qualities: { label: string; count: number }[]; total: number };
export const transferActive = (item: EpisodeTransfer) => ["registering", "checking", "waiting", "queued", "uploading", "deleting"].includes(item.status);
export const transferKey = (item: { episode: number; quality: string }) => item.episode + "|" + item.quality;
export const transferPaused = (row: DownloadRecord, item: EpisodeTransfer) => row.itemPaused?.[transferKey(item)] ?? Boolean(row.paused);
export const visibleTransfers = (row: DownloadRecord) => row.items.filter(item => !row.removedItems?.[transferKey(item)]);
export type TransferReference = { recordId: string; episode: number; quality: string; job?: string; controllable: boolean };
export type GroupedTransfer = { id: string; item: EpisodeTransfer; references: TransferReference[]; paused: boolean; busy: boolean; updatedAt: number };
export type AnimeDownloadGroup = { slug: string; title: string; records: DownloadRecord[]; items: GroupedTransfer[]; pending: number; total: number; activeCount: number };

/** Presentation groups never replace the durable request/batch identities. */
export function groupDownloadRecords(records: DownloadRecord[]): AnimeDownloadGroup[] {
  const groups = new Map<string, AnimeDownloadGroup & { byFile: Map<string, GroupedTransfer>; pendingActive: number }>();
  for (const row of records) {
    let group = groups.get(row.slug);
    if (!group) { group = { slug: row.slug, title: row.title, records: [], items: [], pending: 0, total: 0, activeCount: 0, byFile: new Map(), pendingActive: 0 }; groups.set(row.slug, group); }
    group.records.push(row);
    const loaded = new Set(row.items.map(transferKey));
    const hiddenMissing = Object.keys(row.removedItems || {}).filter(key => !loaded.has(key)).length;
    const missing = Math.max(0, row.total - row.items.length - hiddenMissing);
    group.pending += missing;
    const unseenOverrides = Object.entries(row.itemPaused || {}).filter(([key]) => !loaded.has(key) && !row.removedItems?.[key]);
    group.pendingActive += Math.max(0, row.paused ? unseenOverrides.filter(([, paused]) => !paused).length : missing - unseenOverrides.filter(([, paused]) => paused).length);
    for (const item of visibleTransfers(row)) {
      const key = transferKey(item), job = item.job || (!row.all ? row.serverId : undefined);
      // Different file revisions retain separate identities even at the same
      // episode/quality. Unknown jobs merge only after the server confirms them.
      const id = key + "|" + (job || row.id);
      const reference = { recordId: row.id, episode: item.episode, quality: item.quality, job, controllable: !row.all || Boolean(row.serverId && job) };
      const paused = transferPaused(row, item), busy = Boolean(row.control || row.itemControls?.[key]);
      const previous = group.byFile.get(id);
      if (!previous) group.byFile.set(id, { id, item, references: [reference], paused, busy, updatedAt: row.updatedAt });
      else {
        previous.references.push(reference); previous.paused = previous.paused && paused; previous.busy = previous.busy || busy;
        if (row.updatedAt > previous.updatedAt) { previous.item = item; previous.updatedAt = row.updatedAt; }
      }
    }
  }
  return [...groups.values()].map(({ byFile, pendingActive, ...group }) => {
    const items = [...byFile.values()].sort((a, b) => a.item.episode - b.item.episode || a.item.quality.localeCompare(b.item.quality) || a.id.localeCompare(b.id));
    return { ...group, items, total: items.length + group.pending, activeCount: pendingActive + items.filter(row => transferActive(row.item) && !row.paused).length };
  }).filter(group => group.total > 0);
}

/** Stable row identities keep unchanged waiting episodes out of React paints. */
export function reconcileTransfers(previous: EpisodeTransfer[], incoming: EpisodeTransfer[]) {
  const old = new Map(previous.map(item => [item.episode + "|" + item.quality, item]));
  const fields = ["job", "status", "bytes", "streamBytes", "live", "size", "url", "provider", "bucket", "error", "phase", "speed", "percent", "etaSeconds", "queueAhead", "updatedAt", "retryAt"] as const;
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
        const size = typeof item.size === "number" && Number.isFinite(item.size) && item.size > 0 ? item.size : undefined;
        const streamBytes = typeof item.streamBytes === "number" && Number.isSafeInteger(item.streamBytes) && item.streamBytes > 0 && size !== undefined && Number.isSafeInteger(size) && item.streamBytes < size ? item.streamBytes : undefined;
        const url = validDownloadTarget(item.url) ? item.url : undefined;
        const liveFlag = item.live;
        const liveMalformed = liveFlag !== undefined && typeof liveFlag !== "boolean";
        const liveSafe = liveFlag === true && isSafeDownloadReply(item);
        const keepLive = liveSafe && !recheck;
        // Short-lived live URLs are never trusted from persisted history. A
        // malformed live flag also invalidates its URL instead of upgrading it
        // into a normal download link.
        const keepUrl = liveMalformed || (liveFlag === true && !liveSafe) ? undefined : keepLive ? url : liveFlag === true ? undefined : url;
        return [{ ...item, job: /^[a-f0-9]{64}$/.test(item.job || "") ? item.job : undefined, bytes: typeof item.bytes === "number" && Number.isFinite(item.bytes) ? Math.max(0,item.bytes) : 0, size, error: typeof item.error === "string" ? item.error.slice(0,1200) : undefined, url: keepUrl, live: keepLive, streamBytes: keepLive ? streamBytes : undefined, status: recheck && item.status === "ready" ? "checking" as const : item.status }];
      });
      if (!row.all && (!Number.isInteger(row.episode) || row.episode! <= 0)) return [];
      const itemKey = /^[1-9]\d{0,5}\|.{1,100}$/;
      const itemPaused = Object.fromEntries(Object.entries(row.itemPaused || {}).slice(0, 2000).filter(([key, value]) => itemKey.test(key) && typeof value === "boolean"));
      const removedItems = Object.fromEntries(Object.entries(row.removedItems || {}).slice(0, 2000).filter(([key, value]) => itemKey.test(key) && typeof value === "number" && Number.isFinite(value) && value > 0));
      const itemControls = Object.fromEntries(Object.entries(row.itemControls || {}).slice(0, 2000).filter(([key, value]) => itemKey.test(key) && value && ["pause", "resume"].includes(value.action) && /^[a-f0-9]{64}$/.test(value.job || "")));
      return [{ ...row, paused: row.paused === true, control: row.control === "pause" || row.control === "resume" ? row.control : undefined, itemPaused, itemControls, removedItems, error: typeof row.error === "string" ? row.error.slice(0,1200) : undefined, title: row.title.slice(0, 400), quality: row.quality.slice(0, 50), all: row.all === true, serverId: /^[a-f0-9]{64}$/.test(row.serverId || "") ? row.serverId : undefined, total: Math.max(items.length, Math.min(2000, Number(row.total) || 1)), items }];
    });
  } catch { return []; }
}

export function mergeDownloadHistory(left: DownloadRecord[], right: DownloadRecord[]) {
  const result = new Map(left.map(row => [row.id, row]));
  for (const row of right) {
    const previous = result.get(row.id);
    const removedItems = previous ? { ...previous.removedItems } : {};
    for (const [key, at] of Object.entries(row.removedItems || {})) removedItems[key] = Math.max(removedItems[key] || 0, at);
    if (previous && row.updatedAt <= previous.updatedAt) { result.set(row.id, { ...previous, removedItems }); continue; }
    if (previous && row.serverId === previous.serverId && row.items.length < row.total && previous.items.length > row.items.length) {
      const preview = new Map(row.items.map(item => [item.episode + "|" + item.quality, item]));
      result.set(row.id, { ...row, removedItems, items: previous.items.map(item => preview.get(item.episode + "|" + item.quality) || item) });
    } else result.set(row.id, { ...row, removedItems });
  }
  return [...result.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function progressPercent(item: EpisodeTransfer) {
  if (item.status === "ready") return 100;
  return item.size && Number.isFinite(item.size) && item.size > 0 && Number.isFinite(item.bytes || 0) ? Math.max(0, Math.min(99.9, Math.floor((item.bytes || 0) / item.size * 1000) / 10)) : 0;
}
