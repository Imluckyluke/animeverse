"use client";

import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "framer-motion";
import { ArrowDownToLine, Check, ChevronDown, Download, Layers3, Loader2, Pause, Play, RefreshCw, Trash2, X } from "lucide-react";
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { faBytes, faDigits } from "@/lib/utils";
import { groupDownloadRecords, progressPercent, transferActive, type AnimeDownloadGroup, type GroupedTransfer, type EpisodeTransfer } from "@/lib/download-manager";
import { isLocalCacheUrl, validDownloadTarget } from "@/lib/download-cache-contract";
import { lockPageScroll } from "@/lib/scroll-lock";
import { useDownloadActions, useDownloads } from "./downloads-provider";
import { useApp } from "@/lib/app-context";

function statusLabel(item: EpisodeTransfer) {
  if (item.live === true) return "در حال دریافت از تلگرام؛ دانلود مستقیم منتظر تکمیل نمی‌ماند";
  if (item.status !== "ready") {
    switch (item.phase) {
      case "metadata": return "در حال دریافت اطلاعات فایل از تلگرام";
      case "receiving": return "در حال دریافت فایل از تلگرام";
      case "waiting_data": return "منتظر ادامهٔ دریافت از تلگرام";
      case "verifying": return "بررسی صحت و ثبت فایل روی سرور";
      case "capacity": return "در انتظار فضای خالی سرور";
      case "cooldown": return "در انتظار تلاش مجدد پس از وقفهٔ ارتباط";
      case "paused": return "آماده‌سازی متوقف است";
    }
    if (["waiting", "queued"].includes(item.status) && item.queueAhead !== undefined) {
      return item.queueAhead > 0 ? `در صف دریافت؛ ${faDigits(item.queueAhead)} فایل جلوتر است` : "در انتظار شروع دریافت؛ فایلی جلوتر نیست";
    }
  }
  switch (item.status) {
    case "registering": return "در حال ثبت درخواست";
    case "checking": return "بررسی وضعیت ذخیره‌شده";
    case "waiting": return item.error ? "در انتظار ظرفیت سرور" : "در نوبت آماده‌سازی";
    case "queued": return "در صف انتقال";
    case "uploading": return progressPercent(item) >= 99 ? "بررسی نهایی" : "در حال آماده‌سازی";
    case "ready": return "آمادهٔ دریافت";
    case "expired": return "لینک منقضی شده";
    case "failed": return "آماده‌سازی انجام نشد";
    case "deleting": return "کش موقت منقضی شده است";
  }
}

function BulkQualityPicker({ options, value, onChange }: { options: { label: string; count: number }[]; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const chosen = options.find(option => option.label === value);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    const timer = window.setTimeout(() => root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus(), 0);
    return () => { document.removeEventListener('pointerdown', outside); window.clearTimeout(timer); };
  }, [open]);
  return <div ref={root} className="relative mt-2" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    if (event.key === 'Tab') setOpen(false);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }}>
    <button ref={trigger} id="download-bulk-quality" type="button" role="combobox" aria-label="کیفیت قسمت‌ها" aria-expanded={open} aria-controls="download-quality-options" aria-haspopup="listbox" onClick={() => setOpen(current => !current)} className="download-quality-select flex w-full items-center justify-between gap-3 text-start">
      <span><b dir="ltr">{chosen?.label || "انتخاب کیفیت"}</b>{chosen && <span className="download-muted ms-2 text-[11px]">{faDigits(chosen.count)} قسمت</span>}</span><ChevronDown className={`size-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id="download-quality-options" role="listbox" aria-label="کیفیت قسمت‌ها" className="download-route-menu absolute inset-x-0 top-[calc(100%+6px)] z-50 max-h-52 overflow-y-auto rounded-2xl border border-white/15 p-1.5 shadow-2xl backdrop-blur-xl">
      {options.map(option => <button key={option.label} type="button" role="option" aria-selected={option.label === value} onClick={() => { onChange(option.label); setOpen(false); trigger.current?.focus(); }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-start text-xs text-content-soft transition-colors hover:bg-white/10 focus-visible:bg-white/10">
        <b dir="ltr">{option.label}</b><span className="download-muted flex-1 text-[11px]">{faDigits(option.count)} قسمت</span>{option.label === value && <Check className="size-3.5 text-amber-300" />}
      </button>)}
    </div>}
  </div>;
}

const TransferRow = memo(function TransferRow({ transfer, slug, title }: { transfer: GroupedTransfer; slug: string; title: string }) {
  const { item, paused, busy, references } = transfer;
  const { startDownload, controlDownload, removeDownload } = useDownloadActions();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const reduced = useReducedMotion();
  const percent = progressPercent(item);
  const ready = item.status === "ready" && validDownloadTarget(item.url);
  const live = item.status === "uploading" && item.live === true && item.provider === "local" && isLocalCacheUrl(item.url);
  const directAvailable = ready || live && !paused;
  const failed = item.status === "failed" || item.status === "expired";
  const canControl = transferActive(item) && references.every(reference => reference.controllable);
  const control = (action: "pause" | "resume") => references.forEach(reference => controlDownload(reference.recordId, action, reference.episode, reference.quality));
  return <motion.div layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : .18 }} className="download-episode" data-download-episode={item.episode} data-download-quality={item.quality}>
    <div className="download-episode-head">
      <span className="download-episode-number">{faDigits(item.episode)}</span>
      <div className="min-w-0 flex-1"><p className="text-xs font-bold">قسمت {faDigits(item.episode)} <span className="download-muted ms-1 text-[10px]" dir="ltr">{item.quality}</span></p><p className="download-muted mt-1 text-[10px]" role="status">{paused && !ready ? "متوقف‌شده" : statusLabel(item)}</p></div>
      {directAvailable ? <a className="download-action" href={item.url} download rel="noopener noreferrer" aria-label={`دانلود مستقیم قسمت ${faDigits(item.episode)}`} title="اگر مرورگر دریافت خودکار را شروع نکرد، همین دانلود مستقیم را بزن"><ArrowDownToLine className="size-3.5" />دانلود مستقیم</a>
        : failed ? <button className="download-action" onClick={() => startDownload({ slug, title, episode: item.episode, quality: item.quality, size: item.size }, { autoStart: true })}><RefreshCw className="size-3.5" />تلاش دوباره</button>
        : <span className="download-percent">{faDigits(percent.toFixed(1)).replace(".", "٫")}٪</span>}
    </div>
    <div className={`download-progress ${ready ? "is-ready" : ""} ${!paused && transferActive(item) && !item.bytes ? "is-waiting" : ""}`} role="progressbar" aria-label={live ? `پیشرفت آماده‌سازی سرور برای قسمت ${faDigits(item.episode)}` : `آماده‌سازی قسمت ${faDigits(item.episode)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={live ? `${faDigits(percent.toFixed(1))} درصد پیشرفت سرور؛ ${statusLabel(item)}` : `${faDigits(percent.toFixed(1))} درصد؛ ${statusLabel(item)}`}>
      <span style={{ transform: `scaleX(${percent / 100})` }} />
    </div>
    <div className="download-muted mt-1.5 flex justify-between gap-2 text-[9px]"><span>{item.size ? `${live ? "سرور: " : ""}${faBytes(item.bytes)} از ${faBytes(item.size)}` : "در حال بررسی فایل"}</span>{ready && <span className="inline-flex items-center gap-1"><Check className="size-3" />آماده</span>}</div>
    {live && <p className="download-muted mt-1 text-[10px] leading-5" role="note">همان دانلود مستقیم، دریافت گوشی را از بایت‌های رسیده آغاز می‌کند؛ منتظر تکمیل سرور نمی‌ماند. این درصد مربوط به سرور است، نه پیشرفت دانلود روی گوشی. اگر مرورگر اجازه نداد، همان «دانلود مستقیم» را دوباره بزن.</p>}
    {!ready && transferActive(item) && <div className="download-muted mt-1 flex flex-wrap justify-between gap-2 text-[10px]" aria-live="off">
      <span>{item.speed && item.speed > 0 ? `${faBytes(item.speed)} در ثانیه` : item.phase === "receiving" ? "در حال محاسبهٔ سرعت دریافت" : item.phase === "verifying" ? "دریافت کامل شده؛ بررسی نهایی" : item.phase === "waiting_data" ? "منتظر رسیدن دادهٔ بعدی" : "دریافت فایل هنوز شروع نشده است"}</span>
      {item.etaSeconds != null && item.etaSeconds > 0 && <span>حدود {faDigits(Math.ceil(item.etaSeconds >= 60 ? item.etaSeconds / 60 : item.etaSeconds))} {item.etaSeconds >= 60 ? "دقیقه" : "ثانیه"} باقی مانده</span>}
    </div>}
    <div className="download-episode-tools">
      <button className="download-action download-icon-action" disabled={!canControl || paused || busy} aria-label={`توقف قسمت ${faDigits(item.episode)} با کیفیت ${item.quality}`} title="توقف آماده‌سازی این قسمت" onClick={() => control("pause")}>{busy ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Pause className="size-3.5" />}</button>
      <button className="download-action download-icon-action download-resume" disabled={!canControl || !paused || busy} aria-label={`ادامهٔ قسمت ${faDigits(item.episode)} با کیفیت ${item.quality}`} title="ادامهٔ آماده‌سازی این قسمت" onClick={() => control("resume")}><Play className="size-3.5" /></button>
      <button className="download-action download-icon-action download-danger ms-auto" aria-label={`حذف قسمت ${faDigits(item.episode)} با کیفیت ${item.quality} از تاریخچه`} title="حذف این قسمت از تاریخچه" onClick={() => setConfirmRemove(value => !value)}><Trash2 className="size-3.5" /></button>
    </div>
    <AnimatePresence initial={false}>{confirmRemove && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : .16 }} className="overflow-hidden"><div className="download-confirm"><span className="flex-1">از تاریخچه حذف شود؟{transferActive(item) ? " آماده‌سازی ادامه دارد." : ""}</span><button className="download-action download-danger" onClick={() => references.forEach(reference => removeDownload(reference.recordId, reference.episode, reference.quality))}>حذف</button><button className="download-action download-neutral" onClick={() => setConfirmRemove(false)}>انصراف</button></div></motion.div>}</AnimatePresence>
    {failed && item.error && <p className="download-error mt-2 text-[10px] leading-6">آماده‌سازی انجام نشد؛ دوباره تلاش کن.</p>}
  </motion.div>;
});

const AnimeCard = memo(function AnimeCard({ group, focusId }: { group: AnimeDownloadGroup; focusId: string }) {
  const [shown, setShown] = useState(8);
  const [expanded, setExpanded] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const reduced = useReducedMotion();
  const { retryDownload, controlAnime, removeAnime } = useDownloadActions();
  const focused = group.records.some(record => record.id === focusId);
  useEffect(() => { if (focused && focusId) setExpanded(true); }, [focused, focusId]);
  const ready = group.items.filter(row => row.item.status === "ready").length;
  const busy = group.records.some(record => record.control || Object.keys(record.itemControls || {}).length);
  const canPause = group.activeCount > 0;
  const canResume = group.items.some(row => transferActive(row.item) && row.paused) || group.records.some(record => record.paused && record.total > record.items.length);
  const errors = group.records.filter(record => record.error);
  const recordIds = group.records.map(record => record.id);
  return <motion.section layout="position" initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, scale: reduced ? 1 : .98 }} transition={{ duration: reduced ? 0 : .2 }} className={`download-record ${focused ? "is-focused" : ""}`} id={"download-record-" + group.slug} data-download-anime={group.slug}>
    <button type="button" className="download-record-heading w-full text-start" aria-expanded={expanded} aria-controls={"parts-" + group.slug} onClick={() => setExpanded(value => !value)}><span className="download-record-icon"><Layers3 className="size-4" /></span><span className="min-w-0 flex-1"><span dir="ltr" className="block truncate text-right text-xs font-bold">{group.title}</span><span className="download-muted mt-1 block text-[10px]">{faDigits(ready)} از {faDigits(group.total)} آماده{canResume && !canPause ? " · متوقف‌شده" : ""}</span></span><ChevronDown className={`size-4 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} /></button>
    <div className="download-record-tools">
      <button className="download-action" disabled={!canPause || busy} aria-label={`توقف همهٔ قسمت‌های ${group.title}`} onClick={() => controlAnime(group.slug, "pause", recordIds)}>{busy ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> : <Pause className="size-3" />}توقف همه</button>
      <button className="download-action download-resume" disabled={!canResume || busy} aria-label={`ادامهٔ همهٔ قسمت‌های ${group.title}`} onClick={() => controlAnime(group.slug, "resume", recordIds)}><Play className="size-3" />ادامهٔ همه</button>
      <button className="download-action download-icon-action download-danger ms-auto" title="حذف انیمه از تاریخچه" aria-label={`حذف ${group.title} از تاریخچه`} onClick={() => setConfirmRemove(value => !value)}><Trash2 className="size-3.5" /></button>
    </div>
    <AnimatePresence initial={false}>{confirmRemove && <motion.div key="confirm" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : .16 }} className="overflow-hidden"><div className="download-confirm"><span className="flex-1">این انیمه از تاریخچه حذف شود؟{canPause || canResume ? " آماده‌سازی ادامه دارد." : ""}</span><button className="download-action download-danger" onClick={() => removeAnime(group.slug, recordIds)}>حذف</button><button className="download-action download-neutral" onClick={() => setConfirmRemove(false)}>انصراف</button></div></motion.div>}</AnimatePresence>
    {errors.length > 0 && <div className="download-connection-error" role="status"><p>دریافت وضعیت تازه قطع شده؛ درصدها مربوط به آخرین اطلاعات سرور هستند. اتصال خودکار دوباره امتحان می‌شود.</p><button onClick={() => errors.forEach(record => retryDownload(record.id))}><RefreshCw className="size-3" />تلاش دوباره</button></div>}
    <AnimatePresence initial={false}>{expanded && <motion.div key="parts" id={"parts-" + group.slug} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : .22, ease: 'easeOut' }} className="download-parts overflow-hidden">
      {group.pending > 0 && <div className="download-registering"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />در حال دریافت فهرست قسمت‌ها…</div>}
      <AnimatePresence initial={false}>{group.items.slice(0, shown).map(transfer => <TransferRow key={transfer.id} transfer={transfer} slug={group.slug} title={group.title} />)}</AnimatePresence>
      {group.items.length > shown && <button className="download-more" onClick={() => setShown(value => value + 30)}>نمایش قسمت‌های بیشتر<ChevronDown className="size-3.5" /></button>}
    </motion.div>}</AnimatePresence>
  </motion.section>;
});

function DownloadOverlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const present = useIsPresent();
  const presentRef = useRef(present); presentRef.current = present;
  const reduced = useReducedMotion();
  const overlayId = useId();
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const unlock = lockPageScroll();
    window.dispatchEvent(new CustomEvent("av-downloads-open", { detail: overlayId }));
    panel.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (!presentRef.current) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],select') || [])].filter(node => node.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    // AnimatePresence retains this component until BOTH independent layers
    // finish. Scroll unlock and focus restoration must not precede that exit.
    return () => {
      document.removeEventListener("keydown", keydown); unlock();
      window.dispatchEvent(new CustomEvent("av-downloads-close", { detail: overlayId }));
      requestAnimationFrame(() => {
        if (document.querySelector('.downloads-panel')) return;
        (previous?.isConnected ? previous : document.querySelector<HTMLElement>('[aria-haspopup="menu"]'))?.focus({ preventScroll: true });
      });
    };
  }, [onClose, overlayId]);
  const duration = reduced ? 0 : .2;
  return <div className="downloads-layer" data-closing={!present}>
    <motion.button className="downloads-backdrop" onClick={onClose} aria-label="بستن دانلودها" tabIndex={-1} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration, ease: "easeOut" }} />
    <motion.section ref={panel} role="dialog" aria-modal="true" aria-labelledby="downloads-heading" tabIndex={-1} className="downloads-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration, ease: [.16, 1, .3, 1] }}>{children}</motion.section>
  </div>;
}

export function DownloadCenter() {
  const { user } = useApp();
  const { records: history, open, bulk, focusId, activeCount: savedActiveCount, storageWarning } = useDownloads();
  const records = user ? history : history.filter(record => record.id === focusId);
  const groups = useMemo(() => groupDownloadRecords(records), [records]);
  const activeCount = user ? savedActiveCount : groups.reduce((count, group) => count + group.activeCount, 0);
  const { openDownloads, closeDownloads, startBulk, dismissBulk, clearDownloads } = useDownloadActions();
  const [confirmClear, setConfirmClear] = useState(false);
  const previousUser = useRef(Boolean(user));
  useEffect(() => {
    if (previousUser.current && !user) closeDownloads();
    previousUser.current = Boolean(user);
  }, [user, closeDownloads]);
  const [mounted, setMounted] = useState(false);
  const [quality, setQuality] = useState("");
  const [visible, setVisible] = useState(4);
  useEffect(() => setMounted(true), []);
  useEffect(() => { if (bulk) setQuality(bulk.qualities.some(q => q.label === "720p") ? "720p" : bulk.qualities[0]?.label || ""); }, [bulk]);
  useEffect(() => {
    if (focusId) setVisible(value => Math.max(value, groups.findIndex(group => group.records.some(row => row.id === focusId)) + 1));
  }, [focusId, groups]);
  if (!mounted) return null;
  const selected = bulk?.qualities.find(q => q.label === quality);
  return createPortal(<>
    {user && activeCount > 0 && <button className="downloads-launcher glass-surface" onClick={openDownloads} aria-label="دانلودهای من" title="دانلودهای من" aria-hidden={open} tabIndex={open ? -1 : 0}><span className="downloads-launcher-icon" aria-hidden><Download className="size-5" /></span><span className="downloads-launcher-badge">{activeCount > 99 ? "۹۹+" : faDigits(activeCount)}</span></button>}
    <AnimatePresence>
      {open && <DownloadOverlay key="downloads" onClose={closeDownloads}>
          <header className="downloads-heading"><span className="download-record-icon"><Download className="size-5" /></span><div className="flex-1"><h2 id="downloads-heading" className="text-sm font-black">{bulk ? "دانلود همهٔ قسمت‌ها" : user ? "دانلودهای من" : "آماده‌سازی دانلود"}</h2><p className="download-muted mt-1 text-[10px]">{bulk ? "کیفیت را انتخاب کن و همه را در صف بگذار" : activeCount ? `${faDigits(activeCount)} قسمت در حال آماده‌سازی` : "وضعیت و فایل‌های آمادهٔ دریافت"}</p></div><button className="downloads-close" onClick={closeDownloads} aria-label="بستن پنجرهٔ دانلودها"><X className="size-4" /></button></header>
          <div className="downloads-scroll">
            {!bulk && user && records.length > 0 && <div className="mb-3 flex flex-wrap items-center justify-end gap-2 text-xs">{confirmClear ? <><span className="me-auto">همهٔ تاریخچه پاک شود؟</span><button className="download-action download-danger" onClick={() => { clearDownloads(); setConfirmClear(false); }}>پاک‌کردن همه</button><button className="download-action download-neutral" onClick={() => setConfirmClear(false)}>انصراف</button></> : <button className="download-action download-neutral" onClick={() => setConfirmClear(true)}><Trash2 className="size-3" />پاک‌کردن تاریخچه</button>}</div>}
            {storageWarning && <p className="download-connection-error">ذخیرهٔ تاریخچه انجام نشد.</p>}
            {bulk ? <div className="downloads-bulk">
              <h3 dir="ltr" className="text-right text-sm font-bold leading-7">{bulk.title}</h3>
              <label className="mt-5 block text-xs font-bold" htmlFor="download-bulk-quality">کیفیت قسمت‌ها</label>
              <BulkQualityPicker options={bulk.qualities} value={quality} onChange={setQuality} />
              <p className="download-muted mt-3 text-xs leading-7">این کیفیت برای {faDigits(selected?.count || 0)} از {faDigits(bulk.total)} قسمت فایل آماده دارد؛ فقط همین قسمت‌ها ثبت می‌شوند، بدون جایگزین‌کردن کیفیت دیگر.</p>
              <p className="download-muted mt-3 text-xs leading-7">می‌توانی پنجره را ببندی و بعداً ادامه بدهی.</p>
              <button className="btn btn-primary mt-5 min-h-11 w-full text-xs" disabled={!selected?.count} onClick={() => startBulk(bulk, quality)}><Layers3 className="size-4" />آماده‌سازی {faDigits(selected?.count || 0)} قسمت</button>
              <button className="download-more mt-3" onClick={dismissBulk}>بازگشت به دانلودها</button>
            </div> : <><div className="downloads-records"><AnimatePresence initial={false}>{groups.slice(0, visible).map(group => <AnimeCard key={group.slug} group={group} focusId={focusId} />)}</AnimatePresence>{groups.length > visible && <button className="download-more" onClick={() => setVisible(value => value + 20)}>نمایش دانلودهای قبلی</button>}</div>{!groups.length && <div className="downloads-empty"><Download className="mx-auto size-9 opacity-50" /><h3 className="mt-4 text-sm font-bold">هنوز دانلودی ثبت نکرده‌ای</h3><p className="download-muted mt-2 text-xs leading-7">از صفحهٔ هر انیمه، کیفیت یک قسمت یا گزینهٔ دانلود همهٔ قسمت‌ها را انتخاب کن.</p></div>}</>}
          </div>
          <footer className="downloads-footer">پس از آماده‌شدن، «دریافت فایل» را بزن.</footer>
      </DownloadOverlay>}
    </AnimatePresence>
  </>, document.body);
}
