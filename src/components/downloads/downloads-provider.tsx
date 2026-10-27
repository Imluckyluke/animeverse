"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DOWNLOAD_STORAGE, mergeDownloadHistory, parseDownloadHistory, persistableDownloadHistory, reconcileTransfers, transferActive, type BulkSelection, type DownloadRecord, type DownloadSelection, type EpisodeTransfer } from "@/lib/download-manager";
import { validDownloadTarget, type DownloadBatchReply, type DownloadCacheReply } from "@/lib/download-cache-contract";

type Actions = {
  openDownloads: () => void; closeDownloads: () => void;
  startDownload: (selection: DownloadSelection) => void;
  chooseBulk: (selection: BulkSelection) => void;
  startBulk: (selection: BulkSelection, quality: string) => void;
  dismissBulk: () => void; retryDownload: (id: string) => void;
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
  const startDownload = useCallback((selection: DownloadSelection) => {
    const found = current.current.find(row => row.slug === selection.slug && row.quality === selection.quality && row.items.some(item => item.episode === selection.episode && !["failed", "expired"].includes(item.status)));
    setOpen(true); setBulk(null);
    if (found) { setFocusId(found.id); force.current.add(found.id); pumpRef.current(); return; }
    const now = Date.now(); const id = crypto.randomUUID();
    const row: DownloadRecord = { id, ...selection, all: false, createdAt: now, updatedAt: now, total: 1, items: [{ episode: selection.episode, quality: selection.quality, status: "registering", size: selection.size || undefined, bytes: 0 }] };
    commit(previous => [row, ...previous]); setFocusId(id); pumpRef.current();
  }, [commit]);
  const chooseBulk = useCallback((selection: BulkSelection) => { setBulk(selection); setOpen(true); }, []);
  const startBulk = useCallback((selection: BulkSelection, quality: string) => {
    const found = current.current.find(row => row.all && row.slug === selection.slug && row.quality === quality && (!row.items.length || row.items.some(transferActive)));
    setBulk(null); setOpen(true);
    if (found) { setFocusId(found.id); force.current.add(found.id); pumpRef.current(); return; }
    const now = Date.now(), id = crypto.randomUUID();
    const row: DownloadRecord = { id, slug: selection.slug, title: selection.title, quality, all: true, total: selection.qualities.find(q => q.label === quality)?.count || 0, createdAt: now, updatedAt: now, items: [] };
    commit(previous => [row, ...previous]); setFocusId(id); pumpRef.current();
  }, [commit]);
  const retryDownload = useCallback((id: string) => {
    // A new submission is explicit. Merely reopening the popup never restarts
    // failed/expired uploads or inflates the request counter.
    const now = Date.now(), nextId = crypto.randomUUID();
    commit(previous => previous.map(row => row.id !== id ? row : { ...row, id: nextId, serverId: undefined, error: undefined, updatedAt: now, items: row.all ? [] : row.items.map(item => ({ ...item, status: "registering", url: undefined, bytes: 0 })) }));
    setFocusId(nextId); pumpRef.current();
  }, [commit]);

  useEffect(() => {
    let stopped = false;
    try { current.current = parseDownloadHistory(localStorage.getItem(DOWNLOAD_STORAGE)); } catch { setStorageWarning(true); }
    setRecords(current.current); hydrated.current = true;
    current.current.forEach(row => force.current.add(row.id));
    async function sync(row: DownloadRecord) {
      inFlight.current.add(row.id); force.current.delete(row.id);
      try {
        const response = row.serverId
          ? await fetch("/api/download-cache?" + (row.all ? "batch=" : "job=") + row.serverId, { cache: "no-store", signal: AbortSignal.timeout(20000) })
          : await fetch("/api/download-cache", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", keepalive: true, signal: AbortSignal.timeout(20000), body: JSON.stringify({ slug: row.slug, episode: row.episode, quality: row.quality, requestId: row.id, all: row.all }) });
        const body = await response.json() as DownloadCacheReply & Partial<DownloadBatchReply>;
        if (!response.ok) throw Object.assign(new Error(body.error || "ارتباط با سرویس دانلود برقرار نشد."), { retryAfter: response.status === 429 || response.status === 503 ? 60 : 15 });
        const items: EpisodeTransfer[] = row.all ? body.items || [] : [{ ...body, episode: row.episode!, quality: row.quality }];
        const serverId = row.all ? body.batch : body.job;
        if ((row.all && (!serverId || !items.length || items.length > 2000)) || items.some(item => item.status === "ready" && !validDownloadTarget(item.url))) throw new Error("پاسخ سرویس دانلود معتبر نیست.");
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
        due.current.set(row.id, items.some(transferActive) ? Date.now() + 4000 : Infinity);
      } catch (failure) {
        if (!stopped) {
          const error = failure instanceof Error ? failure.message : "ارتباط قطع شد؛ دوباره تلاش می‌شود.";
          commit(previous => previous.map(item => item.id !== row.id ? item : { ...item, error, updatedAt: Date.now() }), true, true);
          due.current.set(row.id, Date.now() + ((failure as { retryAfter?: number }).retryAfter || 15) * 1000);
        }
      } finally { inFlight.current.delete(row.id); }
    }
    function pump() {
      if (stopped || document.visibilityState === "hidden") return;
      for (const row of current.current) {
        if (inFlight.current.size >= 2) break;
        if (inFlight.current.has(row.id)) continue;
        const active = row.total > row.items.length || !row.serverId && (!row.items.length || row.items.some(transferActive)) || row.items.some(transferActive);
        if ((force.current.has(row.id) || active) && (force.current.has(row.id) || (due.current.get(row.id) || 0) <= Date.now())) void sync(row);
      }
    }
    pumpRef.current = pump;
    const timer = setInterval(pump, 1000);
    const foreground = () => { if (document.visibilityState === "visible") refresh(); };
    const storage = (event: StorageEvent) => {
      if (event.key !== DOWNLOAD_STORAGE) return;
      const incoming = parseDownloadHistory(event.newValue, false);
      for (const row of incoming) if (!current.current.some(old => old.id === row.id) || row.items.length < row.total) force.current.add(row.id);
      commit(previous => mergeDownloadHistory(previous, incoming), false); pump();
    };
    const flushHistory = () => { if (persistTimer.current) { clearTimeout(persistTimer.current); persistHistory(); } };
    window.addEventListener("focus", foreground); document.addEventListener("visibilitychange", foreground); window.addEventListener("storage", storage);
    window.addEventListener("pagehide", flushHistory);
    pump();
    return () => { stopped = true; clearInterval(timer); flushHistory(); window.removeEventListener("pagehide", flushHistory); window.removeEventListener("focus", foreground); document.removeEventListener("visibilitychange", foreground); window.removeEventListener("storage", storage); };
  }, [commit, refresh, persistHistory]);

  const actions = useMemo<Actions>(() => ({ openDownloads, closeDownloads, startDownload, chooseBulk, startBulk, dismissBulk: () => setBulk(null), retryDownload }), [openDownloads, closeDownloads, startDownload, chooseBulk, startBulk, retryDownload]);
  const activeCount = records.reduce((count, row) => count + row.items.filter(transferActive).length + Math.max(0, row.total - row.items.length), 0);
  return <ActionsContext.Provider value={actions}><StateContext.Provider value={{ records, open, bulk, focusId, activeCount, storageWarning }}>{children}</StateContext.Provider></ActionsContext.Provider>;
}
