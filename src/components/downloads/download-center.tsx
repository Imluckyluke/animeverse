"use client";

import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "framer-motion";
import { ArrowDownToLine, Check, ChevronDown, Download, Layers3, Loader2, RefreshCw, X } from "lucide-react";
import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { faBytes, faDigits } from "@/lib/utils";
import { progressPercent, transferActive, type DownloadRecord, type EpisodeTransfer } from "@/lib/download-manager";
import { validDownloadTarget } from "@/lib/download-cache-contract";
import { lockPageScroll } from "@/lib/scroll-lock";
import { useDownloadActions, useDownloads } from "./downloads-provider";

function statusLabel(item: EpisodeTransfer) {
  switch (item.status) {
    case "registering": return "در حال ثبت درخواست";
    case "checking": return "بررسی وضعیت ذخیره‌شده";
    case "waiting": return item.error ? "در انتظار ظرفیت سرور" : "در نوبت آماده‌سازی";
    case "queued": return "در صف انتقال";
    case "uploading": return progressPercent(item) >= 99 ? "بررسی نهایی فایل" : "در حال انتقال به مخزن دانلود";
    case "ready": return "آمادهٔ دریافت";
    case "expired": return "لینک منقضی شده";
    case "failed": return "آماده‌سازی انجام نشد";
    case "deleting": return "کش موقت منقضی شده است";
  }
}

const TransferRow = memo(function TransferRow({ item, slug, title }: { item: EpisodeTransfer; slug: string; title: string }) {
  const { startDownload } = useDownloadActions();
  const percent = progressPercent(item);
  const ready = item.status === "ready" && validDownloadTarget(item.url);
  const failed = item.status === "failed" || item.status === "expired";
  return <div className="download-episode" data-download-episode={item.episode}>
    <div className="download-episode-head">
      <span className="download-episode-number">{faDigits(item.episode)}</span>
      <div className="min-w-0 flex-1"><p className="text-xs font-bold">قسمت {faDigits(item.episode)} <span className="download-muted ms-1 text-[10px]" dir="ltr">{item.quality}</span></p><p className="download-muted mt-1 text-[10px]" role="status">{statusLabel(item)}</p></div>
      {ready ? <a className="download-action" href={item.url} download rel="noopener noreferrer" aria-label={`دریافت فایل قسمت ${faDigits(item.episode)}`}><ArrowDownToLine className="size-3.5" />دریافت فایل</a> : failed ? <button className="download-action" onClick={() => startDownload({ slug, title, episode: item.episode, quality: item.quality, size: item.size })}><RefreshCw className="size-3.5" />تلاش دوباره</button> : <span className="download-percent">{faDigits(percent)}٪</span>}
    </div>
    <div className={`download-progress ${ready ? "is-ready" : ""} ${transferActive(item) && !item.bytes ? "is-waiting" : ""}`} role="progressbar" aria-label={`آماده‌سازی قسمت ${faDigits(item.episode)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span style={{ transform: `scaleX(${percent / 100})` }} />
    </div>
    <div className="download-muted mt-1.5 flex justify-between gap-2 text-[9px]"><span>{item.size ? `${faBytes(item.bytes)} از ${faBytes(item.size)}` : "اندازه پس از بررسی فایل مشخص می‌شود"}</span>{ready && <span className="inline-flex items-center gap-1"><Check className="size-3" />{item.provider === "telegram" ? "تلگرام" : "گیت‌هاب"}</span>}</div>
    {failed && item.error && <p className="download-error mt-2 text-[10px] leading-6">{item.error}</p>}
  </div>;
});

const RecordCard = memo(function RecordCard({ record, focused }: { record: DownloadRecord; focused: boolean }) {
  const [shown, setShown] = useState(8);
  const { retryDownload } = useDownloadActions();
  const ready = record.items.filter(item => item.status === "ready").length;
  return <section className={`download-record ${focused ? "is-focused" : ""}`} id={"download-record-" + record.id}>
    <div className="download-record-heading"><span className="download-record-icon">{record.all ? <Layers3 className="size-4" /> : <Download className="size-4" />}</span><div className="min-w-0 flex-1"><h3 dir="ltr" className="truncate text-right text-xs font-bold">{record.title}</h3><p className="download-muted mt-1 text-[10px]">{record.all ? `${faDigits(record.total)} قسمت · ${faDigits(ready)} آماده` : "دانلود قسمت"}<span dir="ltr" className="ms-2">{record.quality}</span></p></div></div>
    {record.error && <div className="download-connection-error" role="status"><p>{record.error}</p><button onClick={() => retryDownload(record.id)}><RefreshCw className="size-3" />تلاش دوباره</button><p className="mt-1 opacity-80">اگر درخواست قبلاً ثبت شده باشد، انتقال روی سرور ادامه دارد.</p></div>}
    {!record.items.length && <div className="download-registering"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />در حال ثبت همهٔ قسمت‌ها روی سرور…</div>}
    {record.items.slice(0, shown).map(item => <TransferRow key={item.episode + "|" + item.quality} item={item} slug={record.slug} title={record.title} />)}
    {record.items.length > shown && <button className="download-more" onClick={() => setShown(value => value + 30)}>نمایش {faDigits(Math.min(30, record.items.length - shown))} قسمت دیگر<ChevronDown className="size-3.5" /></button>}
  </section>;
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
  const { records, open, bulk, focusId, activeCount, storageWarning } = useDownloads();
  const { openDownloads, closeDownloads, startBulk, dismissBulk } = useDownloadActions();
  const [mounted, setMounted] = useState(false);
  const [quality, setQuality] = useState("");
  const [visible, setVisible] = useState(4);
  useEffect(() => setMounted(true), []);
  useEffect(() => { if (bulk) setQuality(bulk.qualities.some(q => q.label === "720p") ? "720p" : bulk.qualities[0]?.label || ""); }, [bulk]);
  useEffect(() => {
    if (focusId) setVisible(value => Math.max(value, records.findIndex(row => row.id === focusId) + 1));
  }, [focusId, records]);
  if (!mounted) return null;
  const selected = bulk?.qualities.find(q => q.label === quality);
  return createPortal(<>
    {records.length > 0 && <button className="downloads-launcher glass-surface" onClick={openDownloads} aria-label="دانلودهای من" title="دانلودهای من" aria-hidden={open} tabIndex={open ? -1 : 0}><span className="downloads-launcher-icon" aria-hidden><Download className="size-5" /></span>{activeCount > 0 && <span className="downloads-launcher-badge">{activeCount > 99 ? "۹۹+" : faDigits(activeCount)}</span>}</button>}
    <AnimatePresence>
      {open && <DownloadOverlay key="downloads" onClose={closeDownloads}>
          <header className="downloads-heading"><span className="download-record-icon"><Download className="size-5" /></span><div className="flex-1"><h2 id="downloads-heading" className="text-sm font-black">{bulk ? "دانلود همهٔ قسمت‌ها" : "دانلودهای من"}</h2><p className="download-muted mt-1 text-[10px]">{bulk ? "کیفیت را انتخاب کن و همه را در صف بگذار" : activeCount ? `${faDigits(activeCount)} قسمت در حال آماده‌سازی` : "وضعیت و فایل‌های آمادهٔ دریافت"}</p></div><button className="downloads-close" onClick={closeDownloads} aria-label="بستن پنجرهٔ دانلودها"><X className="size-4" /></button></header>
          <div className="downloads-scroll">
            {storageWarning && <p className="download-connection-error">مرورگر اجازهٔ ذخیرهٔ تاریخچه را نمی‌دهد؛ برای بازیابی فهرست بعد از بستن صفحه، دسترسی به فضای ذخیره‌سازی را فعال کن.</p>}
            {bulk ? <div className="downloads-bulk">
              <h3 dir="ltr" className="text-right text-sm font-bold leading-7">{bulk.title}</h3>
              <label className="mt-5 block text-xs font-bold" htmlFor="download-bulk-quality">کیفیت قسمت‌ها</label>
              <select id="download-bulk-quality" className="download-quality-select" value={quality} onChange={event => setQuality(event.target.value)}>{bulk.qualities.map(q => <option key={q.label} value={q.label}>{q.label} · {faDigits(q.count)} قسمت</option>)}</select>
              <p className="download-muted mt-3 text-xs leading-7">این کیفیت برای {faDigits(selected?.count || 0)} از {faDigits(bulk.total)} قسمت فایل آماده دارد؛ فقط همین قسمت‌ها ثبت می‌شوند، بدون جایگزین‌کردن کیفیت دیگر.</p>
              <p className="download-muted mt-3 text-xs leading-7">کل درخواست روی سرور ثبت می‌شود؛ بستن این پنجره یا تب، آماده‌سازی قسمت‌های ثبت‌شده را متوقف نمی‌کند.</p>
              <button className="btn btn-primary mt-5 min-h-11 w-full text-xs" disabled={!selected?.count} onClick={() => startBulk(bulk, quality)}><Layers3 className="size-4" />آماده‌سازی {faDigits(selected?.count || 0)} قسمت</button>
              <button className="download-more mt-3" onClick={dismissBulk}>بازگشت به دانلودها</button>
            </div> : records.length ? <div className="downloads-records">{records.slice(0, visible).map(record => <RecordCard key={record.id} record={record} focused={record.id === focusId} />)}{records.length > visible && <button className="download-more" onClick={() => setVisible(value => value + 20)}>نمایش دانلودهای قبلی</button>}</div> : <div className="downloads-empty"><Download className="mx-auto size-9 opacity-50" /><h3 className="mt-4 text-sm font-bold">هنوز دانلودی ثبت نکرده‌ای</h3><p className="download-muted mt-2 text-xs leading-7">از صفحهٔ هر انیمه، کیفیت یک قسمت یا گزینهٔ دانلود همهٔ قسمت‌ها را انتخاب کن.</p></div>}
          </div>
          <footer className="downloads-footer">انتقال روی سرور انجام می‌شود؛ برای دریافت روی دستگاه، «دریافت فایل» را بزن. فهرست روی همین مرورگر ذخیره می‌شود.</footer>
      </DownloadOverlay>}
    </AnimatePresence>
  </>, document.body);
}
