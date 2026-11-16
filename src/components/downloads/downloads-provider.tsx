"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DOWNLOAD_STORAGE, groupDownloadRecords, mergeDownloadHistory, parseDownloadHistory, persistableDownloadHistory, reconcileTransfers, transferActive, transferKey, transferPaused, visibleTransfers, type BulkSelection, type DownloadRecord, type DownloadSelection, type EpisodeTransfer } from "@/lib/download-manager";
import { isSafeDownloadReply, type DownloadBatchReply, type DownloadCacheReply } from "@/lib/download-cache-contract";
import { createAutomaticDownloads, startNativeDownload } from "@/lib/automatic-download";

type Actions = {
  openDownloads: () => void; closeDownloads: () => void;
  startDownload: (selection: DownloadSelection, options?: { autoStart?: boolean }) => void;
  chooseBulk: (selection: BulkSelection) => void;
  startBulk: (selection: BulkSelection, quality: string) => void;
  dismissBulk: () => void; retryDownload: (id: string) => void;
  controlDownload: (id: string, action: "pause" | "resume", episode?: number, quality?: string) => void;
  controlAnime: (slug: string, action: "pause" | "resume", ids: string[]) => void;
  removeDownload: (id: string, episode?: number, quality?: string) => void;
  removeAnime: (slug: string, ids: string[]) => void; clearDownloads: () => void;
};
type State = { records: DownloadRecord[]; open: boolean; bulk: BulkSelection | null; focusId: string; activeCount: number; storageWarning: boolean };
const ActionsContext = createContext<Actions | null>(null);
const StateContext = createContext<State | null>(null);
export function useDownloadActions() { const value = useContext(ActionsContext); if (!value) throw new Error("DownloadsProvider is missing"); return value; }
export function useDownloads() { const value = useContext(StateContext); if (!value) throw new Error("DownloadsProvider is missing"); return value; }

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [bulk, setBulk] = useState<BulkSelection | null>(null);
  const [focusId, setFocusId] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const current = useRef<DownloadRecord[]>([]);
  const hydrated = useRef(false);
  const force = useRef(new Set<string>());
  const due = useRef(new Map<string, number>());
  const inFlight = useRef(new Set<string>());
  const pumpRef = useRef<() => void>(() => {});
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removed = useRef<Record<string, number>>({});
  const automatic = useRef<ReturnType<typeof createAutomaticDownloads> | null>(null);
  if (!automatic.current) automatic.current = createAutomaticDownloads(startNativeDownload);

  const handoffDownload = useCallback((id: string, items: EpisodeTransfer[]) => {
    const row = current.current.find(row => row.id === id);
    if (!row || row.all) return;
    for (const item of items) {
      const paused = transferPaused(row, item) || row.control === "pause" || row.itemControls?.[transferKey(item)]?.action === "pause";
      try { automatic.current?.consume(id, item, paused); }
      catch { /* Browser/OS may require another gesture; the same direct link remains available. */ }
    }
  }, []);

  const persistHistory = useCallback(() => {
    persistTimer.current = null;
    try { localStorage.setItem(DOWNLOAD_STORAGE, JSON.stringify(persistableDownloadHistory(current.current))); setStorageWarning(false); }
    catch { setStorageWarning(true); }
  }, []);
  const commit = useCallback((change: (previous: DownloadRecord[]) => DownloadRecord[], persist = true, background = false) => {
    const next = change(current.current);
    if (next === current.current) return;
    current.current = next;
    if (background) startTransition(() => setRecords(next)); else setRecords(next);
    if (persist && hydrated.current) {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      if (background) persistTimer.current = setTimeout(persistHistory, 700);
      else persistHistory();
    }
  }, [persistHistory]);
  const refresh = useCallback(() => { current.current.forEach(row => force.current.add(row.id)); pumpRef.current(); }, []);
  const openDownloads = useCallback(() => { setBulk(null); setOpen(true); refresh(); }, [refresh]);
  const closeDownloads = useCallback(() => { setOpen(false); setBulk(null); }, []);
  const startDownload = useCallback((selection: DownloadSelection, options?: { autoStart?: boolean }) => {
    const found = current.current.find(row => !row.all && row.slug === selection.slug && row.quality === selection.quality && visibleTransfers(row).some(item => item.episode === selection.episode && !["failed", "expired"].includes(item.status)));
    setOpen(true); setBulk(null);
    if (found) {
      if (options?.autoStart === true) automatic.current?.arm(found.id, selection);
      setFocusId(found.id);
      const selected = visibleTransfers(found).find(item => item.episode === selection.episode && item.quality === selection.quality);
      if (options?.autoStart === true && selected && transferPaused(found, selected)) {
        commit(rows => rows.map(row => row.id === found.id ? { ...row, control: "resume", error: undefined, updatedAt: Date.now() } : row));
      } else if (options?.autoStart === true) handoffDownload(found.id, visibleTransfers(found));
      force.current.add(found.id); due.current.set(found.id, 0); pumpRef.current(); return;
    }
    const now = Date.now(); const id = crypto.randomUUID();
    const row: DownloadRecord = { id, ...selection, all: false, createdAt: now, updatedAt: now, total: 1, items: [{ episode: selection.episode, quality: selection.quality, status: "registering", size: selection.size || undefined, bytes: 0 }] };
    if (options?.autoStart === true) automatic.current?.arm(id, selection);
    commit(previous => [row, ...previous]); setFocusId(id); pumpRef.current();
  }, [commit, handoffDownload]);
  const chooseBulk = useCallback((selection: BulkSelection) => { setBulk(selection); setOpen(true); }, []);
  const startBulk = useCallback((selection: BulkSelection, quality: string) => {
    const found = current.current.find(row => row.all && row.slug === selection.slug && row.quality === quality && !Object.keys(row.removedItems || {}).length && (!row.items.length || row.items.some(transferActive)));
    setBulk(null); setOpen(true);
    if (found) { setFocusId(found.id); force.current.add(found.id); pumpRef.current(); return; }
    const now = Date.now(), id = crypto.randomUUID();
    const row: DownloadRecord = { id, slug: selection.slug, title: selection.title, quality, all: true, total: selection.qualities.find(q => q.label === quality)?.count || 0, createdAt: now, updatedAt: now, items: [] };
    commit(previous => [row, ...previous]); setFocusId(id); pumpRef.current();
  }, [commit]);
  const retryDownload = useCallback((id: string) => {
    automatic.current?.cancel(id);
    if (current.current.find(row => row.id === id)?.serverId) {
      force.current.add(id); due.current.set(id, 0); pumpRef.current(); return;
    }
    // A new submission is explicit. Merely reopening the popup never restarts
    // failed/expired uploads or inflates the request counter.
    const now = Date.now(), nextId = crypto.randomUUID();
    commit(previous => previous.map(row => row.id !== id ? row : { ...row, id: nextId, serverId: undefined, error: undefined, updatedAt: now, items: row.all ? [] : row.items.map(item => ({ ...item, status: "registering", url: undefined, bytes: 0 })) }));
    setFocusId(nextId); pumpRef.current();
  }, [commit]);

  const controlDownload = useCallback((id: string, action: "pause" | "resume", episode?: number, quality?: string) => {
    if (action === "pause") automatic.current?.cancel(id);
    commit(rows => rows.map(row => {
      if (row.id !== id) return row;
      if (episode !== undefined && row.all) {
        const item = row.items.find(item => item.episode === episode && item.quality === quality);
        if (!item?.job || !/^[a-f0-9]{64}$/.test(item.job)) return row;
        return { ...row, itemControls: { ...row.itemControls, [transferKey(item)]: { action, job: item.job } }, error: undefined, updatedAt: Date.now() };
      }
      return { ...row, control: action, itemControls: {}, error: undefined, updatedAt: Date.now() };
    }));
    force.current.add(id); pumpRef.current();
  }, [commit]);
  const controlAnime = useCallback((slug: string, action: "pause" | "resume", ids: string[]) => {
    const selected = new Set(ids);
    if (action === "pause") ids.forEach(id => automatic.current?.cancel(id));
    commit(rows => rows.map(row => {
      if (row.slug !== slug || !selected.has(row.id) || !(row.total > row.items.length || row.items.some(transferActive))) return row;
      force.current.add(row.id);
      return { ...row, control: action, itemControls: {}, error: undefined, updatedAt: Date.now() };
    }));
    pumpRef.current();
  }, [commit]);
  const removeDownload = useCallback((id: string, episode?: number, quality?: string) => {
    automatic.current?.cancel(id);
    const row = current.current.find(row => row.id === id);
    if (row?.all && episode !== undefined && quality) {
      const removedItems = { ...row.removedItems, [transferKey({ episode, quality })]: Date.now() };
      if (row.total > row.items.length || row.items.some(item => !removedItems[transferKey(item)])) {
        commit(rows => rows.map(item => item.id === id ? { ...item, removedItems, updatedAt: Date.now() } : item)); return;
      }
    }
    removed.current[id] = Date.now();
    try { localStorage.setItem("av_downloads_removed_v1", JSON.stringify(removed.current)); } catch { setStorageWarning(true); }
    commit(rows => rows.filter(row => row.id !== id));
  }, [commit]);
  const removeAnime = useCallback((slug: string, ids: string[]) => {
    ids.forEach(id => automatic.current?.cancel(id));
    const selected = new Set(ids);
    for (const row of current.current) if (row.slug === slug && selected.has(row.id)) removed.current[row.id] = Date.now();
    try { localStorage.setItem("av_downloads_removed_v1", JSON.stringify(removed.current)); } catch { setStorageWarning(true); }
    commit(rows => rows.filter(row => row.slug !== slug || !selected.has(row.id)));
  }, [commit]);
  const clearDownloads = useCallback(() => {
    automatic.current?.clear();
    for (const row of current.current) removed.current[row.id] = Date.now();
    try { localStorage.setItem("av_downloads_removed_v1", JSON.stringify(removed.current)); } catch { setStorageWarning(true); }
    commit(() => []);
  }, [commit]);

  useEffect(() => {
    let stopped = false;
    try { removed.current = JSON.parse(localStorage.getItem("av_downloads_removed_v1") || "{}"); if (!removed.current || Array.isArray(removed.current) || typeof removed.current !== "object") removed.current = {}; } catch { removed.current = {}; }
    try { current.current = parseDownloadHistory(localStorage.getItem(DOWNLOAD_STORAGE)); } catch { setStorageWarning(true); }
    current.current = current.current.filter(row => !removed.current[row.id]);
    setRecords(current.current); hydrated.current = true;
    current.current.forEach(row => force.current.add(row.id));
    async function sync(row: DownloadRecord) {
      inFlight.current.add(row.id); force.current.delete(row.id);
      try {
        const scoped = Object.entries(row.itemControls || {})[0];
        if ((row.control || scoped) && row.serverId) {
          const action = row.control || scoped[1].action;
          const response = await fetch("/api/download-cache", { method: "PATCH", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20000), body: JSON.stringify({ action, id: row.serverId, requestId: row.id, batch: row.all, ...(row.control ? {} : { job: scoped[1].job }) }) });
          const body = await response.json();
          if (!response.ok || body.ok !== true) throw new Error("تغییر وضعیت انجام نشد؛ دوباره تلاش کن.");
          if (stopped) return;
          commit(rows => rows.map(item => {
            if (item.id !== row.id) return item;
            if (row.control) return { ...item, paused: body.paused === true, control: item.control === action ? undefined : item.control, itemPaused: {}, error: undefined, updatedAt: Date.now() };
            const itemControls = { ...item.itemControls };
            if (itemControls[scoped[0]]?.action === action && itemControls[scoped[0]]?.job === scoped[1].job) delete itemControls[scoped[0]];
            return { ...item, itemControls, itemPaused: { ...item.itemPaused, [scoped[0]]: body.paused === true }, error: undefined, updatedAt: Date.now() };
          }));
          due.current.set(row.id, 0);
          return;
        }
        const response = row.serverId
          ? await fetch("/api/download-cache?" + (row.all ? "batch=" : "job=") + row.serverId, { cache: "no-store", signal: AbortSignal.timeout(10000) })
          : await fetch("/api/download-cache", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", keepalive: true, signal: AbortSignal.timeout(20000), body: JSON.stringify({ slug: row.slug, episode: row.episode, quality: row.quality, requestId: row.id, all: row.all }) });
        const body = await response.json() as DownloadCacheReply & Partial<DownloadBatchReply>;
        if (!response.ok) throw Object.assign(new Error(body.error || "ارتباط با سرویس دانلود برقرار نشد."), { retryAfter: response.status === 429 ? 60 : response.status === 503 ? 5 : 3 });
        const items: EpisodeTransfer[] = row.all ? body.items || [] : [{ ...body, episode: row.episode!, quality: row.quality }];
        const serverId = row.all ? body.batch : body.job;
        if ((row.all && (!serverId || !items.length || items.length > 2000)) || items.some(item => !isSafeDownloadReply(item))) throw new Error("پاسخ سرویس دانلود معتبر نیست.");
        if (stopped) return;
        const identityChanged = row.serverId !== serverId;
        commit(previous => {
          let changed = false;
          const next = previous.map(item => {
            if (item.id !== row.id) return item;
            const reconciled = reconcileTransfers(item.items, items);
            if (reconciled === item.items && item.serverId === serverId && !item.error) return item;
            changed = true;
            return { ...item, serverId, items: reconciled, total: items.length, updatedAt: Date.now(), error: undefined };
          });
          return changed ? next : previous;
        }, true, !identityChanged);
        handoffDownload(row.id, items);
        due.current.set(row.id, items.some(transferActive) ? Date.now() + (items.some(item => item.status === "uploading") ? 1000 : 2000) : Infinity);
      } catch (failure) {
        if (!stopped) {
          const error = failure instanceof Error ? failure.message : "ارتباط قطع شد؛ دوباره تلاش می‌شود.";
          commit(previous => previous.map(item => item.id !== row.id ? item : { ...item, error, updatedAt: Date.now() }), true, true);
          due.current.set(row.id, Date.now() + ((failure as { retryAfter?: number }).retryAfter || 3) * 1000);
        }
      } finally { inFlight.current.delete(row.id); }
    }
    function pump() {
      if (stopped || document.visibilityState === "hidden") return;
      for (const row of current.current) {
        if (inFlight.current.size >= 2) break;
        if (inFlight.current.has(row.id)) continue;
        const scopedControl = Object.keys(row.itemControls || {}).length > 0;
        if (row.paused && !row.control && !scopedControl && !force.current.has(row.id) && !Object.values(row.itemPaused || {}).some(paused => !paused)) continue;
        const active = row.total > row.items.length || !row.serverId && (!row.items.length || row.items.some(transferActive)) || row.items.some(transferActive);
        if ((row.control || scopedControl || force.current.has(row.id) || active) && (force.current.has(row.id) || (due.current.get(row.id) || 0) <= Date.now())) void sync(row);
      }
    }
    pumpRef.current = pump;
    const timer = setInterval(pump, 250);
    const foreground = () => { if (document.visibilityState === "visible") refresh(); };
    const storage = (event: StorageEvent) => {
      if (event.key === "av_downloads_removed_v1") {
        try { Object.assign(removed.current, JSON.parse(event.newValue || "{}")); } catch { /* ignore malformed notifications */ }
        Object.keys(removed.current).forEach(id => automatic.current?.cancel(id));
        commit(rows => rows.filter(row => !removed.current[row.id]), false); return;
      }
      if (event.key !== DOWNLOAD_STORAGE) return;
      const incoming = parseDownloadHistory(event.newValue, false);
      for (const row of incoming) {
        if (row.paused || row.control === "pause" || row.items.some(item => transferPaused(row, item))) automatic.current?.cancel(row.id);
      }
      for (const row of incoming) if (!current.current.some(old => old.id === row.id) || row.items.length < row.total) force.current.add(row.id);
      commit(previous => mergeDownloadHistory(previous, incoming).filter(row => !removed.current[row.id]), false); pump();
    };
    const flushHistory = () => { if (persistTimer.current) { clearTimeout(persistTimer.current); persistHistory(); } };
    window.addEventListener("focus", foreground); document.addEventListener("visibilitychange", foreground); window.addEventListener("storage", storage);
    window.addEventListener("pagehide", flushHistory);
    pump();
    return () => { stopped = true; automatic.current?.clear(); clearInterval(timer); flushHistory(); window.removeEventListener("pagehide", flushHistory); window.removeEventListener("focus", foreground); document.removeEventListener("visibilitychange", foreground); window.removeEventListener("storage", storage); };
  }, [commit, refresh, persistHistory, handoffDownload]);

  const actions = useMemo<Actions>(() => ({ openDownloads, closeDownloads, startDownload, chooseBulk, startBulk, dismissBulk: () => setBulk(null), retryDownload, controlDownload, controlAnime, removeDownload, removeAnime, clearDownloads }), [openDownloads, closeDownloads, startDownload, chooseBulk, startBulk, retryDownload, controlDownload, controlAnime, removeDownload, removeAnime, clearDownloads]);
  const activeCount = useMemo(() => groupDownloadRecords(records).reduce((count, group) => count + group.activeCount, 0), [records]);
  return <ActionsContext.Provider value={actions}><StateContext.Provider value={{ records, open, bulk, focusId, activeCount, storageWarning }}>{children}</StateContext.Provider></ActionsContext.Provider>;
}
