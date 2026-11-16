import { isCacheDownloadUrl, isLocalCacheUrl, isSafeDownloadReply } from "./download-cache-contract";
import type { EpisodeTransfer } from "./download-manager";

type Selection = { episode: number; quality: string };

/** A response is a download candidate, not proof that the OS accepted it. */
export function automaticDownloadUrl(item: EpisodeTransfer, now = Date.now()) {
  if (!isSafeDownloadReply(item) || !isCacheDownloadUrl(item.url)) return undefined;
  if (item.status !== "ready" && !(item.status === "uploading" && item.live === true)) return undefined;
  if (isLocalCacheUrl(item.url)) {
    const expires = Number(new URL(item.url).pathname.split("/")[4]);
    if (expires * 1000 <= now + 5000) return undefined;
  }
  return item.url;
}

/** Ephemeral, explicit single-file clicks only. Never persist these intentions
 * or rebuild them from history/focus/status polls/bulk subscriptions. */
export function createAutomaticDownloads(start: (url: string) => void, now = Date.now) {
  const pending = new Map<string, Selection>();
  return {
    arm(id: string, selection: Selection) { pending.set(id, { ...selection }); },
    cancel(id: string) { pending.delete(id); },
    clear() { pending.clear(); },
    consume(id: string, item: EpisodeTransfer, paused = false) {
      const intent = pending.get(id);
      if (!intent || intent.episode !== item.episode || intent.quality !== item.quality) return false;
      if (paused) { pending.delete(id); return false; }
      if (["failed", "expired", "deleting"].includes(item.status)) { pending.delete(id); return false; }
      const url = automaticDownloadUrl(item, now());
      if (!url) return false;
      // Consume before navigation: live -> ready polls and re-entrant callbacks
      // cannot issue a second file. A retry requires another explicit click.
      pending.delete(id);
      start(url);
      return true;
    },
  };
}

/** Native attachment delivery, with no popup or full-file Blob in JS. Keep the
 * hidden browsing context for the lifetime of the page: removing it on a short
 * timer could abort a slow response before its attachment headers arrive. */
export function startNativeDownload(url: string, doc: Document = document) {
  if (!isCacheDownloadUrl(url)) throw new Error("نشانی دانلود مستقیم معتبر نیست.");
  const frame = doc.createElement("iframe");
  frame.width = "0";
  frame.height = "0";
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
  frame.title = "دانلود مستقیم فایل";
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.src = url;
  doc.body.appendChild(frame);
}
