"use client";

import { useEffect, useState } from "react";
import { Check, Eye, Link2, Radio } from "lucide-react";
import type { AdminPostPreview, AdminSession } from "@/lib/admin-contract";
import { confirmPostImport, getPostPreview, isAbortError, isUnauthorized, previewPosts } from "@/lib/admin-client";
import { BusyButton, ConsoleCard, InlineError, SectionHeading, StatusChip, errorText, formatNumber, type ConsoleNotice } from "@/components/admin/console-ui";

const STORAGE = "av_admin_post_preview";
const pending = (value: AdminPostPreview | null) => Boolean(value && ["preview_pending", "import_pending", "importing"].includes(value.state));

export function PostImportsPanel({ session, onUnauthorized, notify }: {
  session: AdminSession; onUnauthorized: () => void; notify: ConsoleNotice;
}) {
  const [posts, setPosts] = useState(50);
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<AdminPostPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [restoredId, setRestoredId] = useState("");
  const working = busy || pending(preview);
  const forgetPreview = () => {
    setPreview(null); setRestoredId(""); setError("");
    try { sessionStorage.removeItem(STORAGE); } catch { /* Optional recovery. */ }
  };

  useEffect(() => {
    try {
      const id = sessionStorage.getItem(STORAGE);
      if (id && /^[a-f0-9]{32}$/.test(id)) setRestoredId(id);
    } catch { /* Browser storage may be unavailable. */ }
  }, []);

  const id = preview?.id || restoredId;
  useEffect(() => {
    if (!id || preview && !pending(preview) && !error) return;
    const controller = new AbortController();
    let timer = 0;
    let attempts = 0;
    const poll = async () => {
      try {
        const result = await getPostPreview(id, controller.signal);
        if (controller.signal.aborted) return;
        setPreview(result);
        setRestoredId("");
        setError("");
        if (pending(result) && ++attempts < 90) timer = window.setTimeout(() => void poll(), 2000);
        else if (pending(result)) setError("بررسی طول کشیده است؛ درخواست روی سرور باقی است. وضعیت را دوباره دریافت کن.");
      } catch (failure) {
        if (isAbortError(failure) || controller.signal.aborted) return;
        if (isUnauthorized(failure)) { onUnauthorized(); return; }
        setError(errorText(failure, "وضعیت بررسی دریافت نشد؛ درخواست را دوباره نساز، وضعیت را تازه کن."));
      }
    };
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
    // Poll the durable request, not a new request for each status response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reload, preview?.state, onUnauthorized]);

  const inspect = async (input: { url: string } | { posts: number }) => {
    forgetPreview(); setBusy(true);
    try {
      const result = await previewPosts(input, session.csrf);
      setPreview(result);
      try { sessionStorage.setItem(STORAGE, result.id); } catch { /* Optional recovery. */ }
    } catch (failure) {
      if (isUnauthorized(failure)) { onUnauthorized(); return; }
      setError(errorText(failure, "درخواست پیش‌نمایش ثبت نشد."));
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!preview || preview.state !== "preview_ready") return;
    setBusy(true); setError("");
    try {
      const result = await confirmPostImport(preview.id, session.csrf);
      setPreview(result);
      notify("تأیید ثبت شد", "فقط فایل‌های همین پیش‌نمایش وارد صف می‌شوند؛ لینک‌های آمادهٔ قبلی حفظ می‌شوند.", "success");
    } catch (failure) {
      if (isUnauthorized(failure)) { onUnauthorized(); return; }
      setError(errorText(failure, "تأیید ثبت نشد؛ وضعیت درخواست را بررسی کن."));
    } finally { setBusy(false); }
  };

  return (
    <ConsoleCard className="p-4 sm:p-5">
      <SectionHeading icon={<Radio className="size-4" />} title="استخراج از انی‌پلاس"
        description="اول فقط پست خوانده و نمونهٔ صفحه نمایش داده می‌شود؛ دریافت فایل و ساخت یا به‌روزرسانی صفحه نیازمند تأیید تو است." />
      <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void inspect({ posts }); }}>
        <label className="min-w-36 flex-1 text-[11px] text-content-muted">تعداد پست آخر (۱ تا ۵۰)
          <input type="number" min={1} max={50} required value={posts} disabled={working}
            onChange={(event) => { setPosts(Number(event.target.value)); forgetPreview(); }} className="field mt-1 h-11 w-full px-3" />
        </label>
        <BusyButton type="submit" busy={busy} disabled={working || !Number.isInteger(posts) || posts < 1 || posts > 50} className="btn btn-glass h-11"><Eye className="size-4" />پیش‌نمایش پست‌های آخر</BusyButton>
      </form>
      <form className="mt-4 border-t border-white/10 pt-4" onSubmit={(event) => { event.preventDefault(); void inspect({ url: url.trim() }); }}>
        <label className="block text-[11px] text-content-muted">یا لینک یک پست مشخص از کانال انی‌پلاس
          <input type="url" required dir="ltr" value={url} disabled={working} autoComplete="off" spellCheck={false}
            onChange={(event) => { setUrl(event.target.value); forgetPreview(); }} placeholder="https://t.me/aniplus/33121"
            className="field mt-1 h-11 w-full px-3 text-sm" />
        </label>
        <BusyButton type="submit" busy={busy} disabled={working || !url.trim()} className="btn btn-primary mt-2 h-11"><Link2 className="size-4" />بررسی لینک و نمایش نمونهٔ صفحه</BusyButton>
      </form>
      {error ? <InlineError message={error} onRetry={id ? () => setReload((value) => value + 1) : undefined} className="mt-3" /> : null}
      {preview ? <div className="mt-4 space-y-3" aria-live="polite">
        {pending(preview) ? <p role="status" className="text-xs leading-6 text-content-muted">{preview.state === "preview_pending" ? "در صف خواندن پست و ساخت پیش‌نمایش؛ هنوز فایل دریافت نمی‌شود…" : "تأیید ثبت شده؛ در حال ثبت پست‌ها در صف دریافت…"}</p> : null}
        {preview.error ? <InlineError message={preview.error} /> : null}
        {preview.warnings?.map((warning) => <p key={warning} className="text-[11px] leading-6 text-amber-300">{warning}</p>)}
        {preview.items?.map((item) => <article key={item.postId} className="av-sub overflow-hidden rounded-2xl p-3" data-testid="post-page-preview">
          <p className="mb-3 text-xs font-bold text-amber-300">نمونهٔ صفحه · هنوز منتشر نشده توسط این درخواست</p>
          <div className="flex items-start gap-3">
            {item.cover && /^(https:\/\/|\/covers\/)/.test(item.cover) ? <img src={item.cover} alt={item.title} referrerPolicy="no-referrer" className="h-36 w-24 shrink-0 rounded-xl object-cover" /> : null}
            <div className="min-w-0"><h3 className="text-base font-black">{item.title}</h3><p dir="ltr" className="mt-1 break-words text-start text-xs text-content-muted">{item.titleEn}</p>
              <p className="mt-2 text-[11px] text-content-muted">{item.year ? formatNumber(item.year) : "سال نامشخص"} · {item.format || "نوع نامشخص"}</p>
              <div className="mt-2 flex flex-wrap gap-1">{item.genres.map((genre) => <StatusChip key={genre}>{genre}</StatusChip>)}</div>
            </div>
          </div>
          <p className="mt-3 whitespace-pre-line text-[11px] leading-7 text-content-muted">{item.synopsis || "خلاصهٔ داستان در پست موجود نیست."}</p>
          <details className="mt-3"><summary className="cursor-pointer text-xs font-bold">{formatNumber(item.fileCount)} فایل در {formatNumber(item.episodes.length)} قسمت · مشاهدهٔ کیفیت‌ها</summary>
            <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto text-[11px]">{item.episodes.map((episode) => <li key={episode.number}>قسمت {formatNumber(episode.number)}: <span dir="ltr">{episode.qualities.join(" · ")}</span></li>)}</ul>
          </details>
          <p className="mt-3 text-[10px] text-content-faint">{item.existing ? "عنوان از قبل وجود دارد؛ صفحهٔ تکراری ساخته نمی‌شود و فایل‌های آماده حفظ می‌شوند." : "صفحهٔ جدید فقط بعد از آماده‌شدن فایل معتبر قابل انتشار است."}</p>
          <a href={item.postUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[11px] text-violet-300">پست منبع در تلگرام</a>
        </article>)}
        {preview.state === "preview_ready" ? <div className="flex flex-wrap gap-2">
          <BusyButton type="button" busy={busy} onClick={() => void confirm()} disabled={busy} className="btn btn-primary min-h-11"><Check className="size-4" />تأیید نمونه و شروع دریافت فایل‌ها</BusyButton>
          <button type="button" disabled={busy} onClick={forgetPreview} className="btn btn-glass min-h-11">انصراف؛ بدون دریافت</button>
        </div> : null}
        {preview.state === "imported" ? <p role="status" className="text-xs leading-7 text-emerald-400">{preview.message}</p> : null}
      </div> : null}
    </ConsoleCard>
  );
}
