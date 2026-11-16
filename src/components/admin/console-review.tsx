"use client";

import type {
  AdminCatalogPage,
  AdminReviewFile,
  AdminReviewPage,
  AdminReviewPreview,
  AdminSession,
} from "@/lib/admin-contract";
import {
  adminErrorMessage,
  applyReview,
  getCatalog,
  getReview,
  isAbortError,
  isUnauthorized,
  previewReview,
  type AdminReviewStatus,
} from "@/lib/admin-client";
import { cn, faNum } from "@/lib/utils";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleDashed,
  Clock3,
  ExternalLink,
  FileSearch,
  Link2,
  Loader2,
  RefreshCw,
  SearchX,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BusyButton,
  ConsoleCard,
  ConsoleDialog,
  EmptyState,
  InlineError,
  LoadingRows,
  Pager,
  SearchField,
  SectionHeading,
  StatusChip,
  commandStateMeta,
  errorText,
  formatBytes,
  formatDateTime,
  formatNumber,
  useCommandPoll,
  useDebouncedValue,
  useNow,
  usePermissions,
  type ConsoleNotice,
} from "@/components/admin/console-ui";

const REVIEW_STATUSES: { key: AdminReviewStatus; label: string }[] = [
  { key: "all", label: "همه" },
  { key: "missing_title", label: "عنوان نامشخص" },
  { key: "missing_episode", label: "قسمت نامشخص" },
  { key: "no_reference_match", label: "بدون تطبیق مرجع" },
  { key: "ambiguous_remake", label: "بازسازی مبهم" },
  { key: "season_conflict", label: "تعارض فصل" },
  { key: "unsafe_record", label: "رکورد ناامن" },
  { key: "catalog_conflict", label: "تعارض کاتالوگ" },
];

const STATUS_LABELS: Record<string, string> = {
  missing_title: "عنوان نامشخص",
  missing_episode: "قسمت نامشخص",
  no_reference_match: "بدون تطبیق مرجع",
  ambiguous_remake: "بازسازی مبهم",
  season_conflict: "تعارض فصل",
  unsafe_record: "رکورد ناامن",
  catalog_conflict: "تعارض کاتالوگ",
  ready: "آماده",
  pending: "در انتظار",
};

function statusTone(status: string): "danger" | "amber" | "violet" | "neutral" {
  if (status === "unsafe_record" || status === "catalog_conflict") return "danger";
  if (status === "season_conflict" || status === "ambiguous_remake") return "amber";
  if (status === "no_reference_match") return "violet";
  return "neutral";
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status ?? "نامشخص";
}

function TelegramLink({ url }: { url: string }) {
  if (!url) return <span className="text-content-faint">—</span>;
  if (!/^https?:\/\//i.test(url)) {
    return (
      <span className="break-all font-mono text-[9.5px] text-content-faint" dir="ltr">
        {url}
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 break-all text-[10px] font-semibold text-violet-300 underline decoration-violet-300/30 underline-offset-4"
    >
      منبع مقصد
      <ExternalLink className="size-2.5 shrink-0" />
    </a>
  );
}

export function ReviewPanel({
  session,
  onUnauthorized,
  notify,
}: {
  session: AdminSession;
  onUnauthorized: () => void;
  notify: ConsoleNotice;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 320);
  const [status, setStatus] = useState<AdminReviewStatus>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminReviewPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [activeFile, setActiveFile] = useState<AdminReviewFile | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const request = ++requestRef.current;
    setError("");
    if (data?.items.length) setRefreshing(true);
    else setLoading(true);
    getReview({ query: debouncedQuery, page, status }, controller.signal)
      .then((payload) => {
        if (request !== requestRef.current) return;
        setData(payload);
      })
      .catch((failure) => {
        if (isAbortError(failure)) return;
        if (isUnauthorized(failure)) {
          onUnauthorized();
          return;
        }
        setError(adminErrorMessage(failure, "فهرست بازبینی دریافت نشد."));
      })
      .finally(() => {
        if (request !== requestRef.current) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => controller.abort();
    // The current list length only decides skeleton vs. subtle refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, status, page, reload, onUnauthorized]);

  const changeQuery = (value: string) => {
    setQuery(value);
    setPage(1);
  };
  const changeStatus = (next: AdminReviewStatus) => {
    setStatus(next);
    setPage(1);
  };

  return (
    <div className="space-y-3">
      <ConsoleCard className="p-4 sm:p-5">
        <SectionHeading
          icon={<FileSearch className="size-4" />}
          title="بازبینی آرشیو"
          description="فایل‌های واقعی نامطمئن؛ پیش‌نمایش اجباری است و اتصال فقط پس از اعمال فرمان در سرور قطعی می‌شود."
          action={
            <div className="flex items-center gap-2">
              {data?.refreshing ? (
                <StatusChip tone="violet">
                  <Loader2 className="size-3 animate-spin" />
                  تازه‌سازی سرور
                </StatusChip>
              ) : null}
              <BusyButton
                type="button"
                busy={refreshing}
                onClick={() => setReload((value) => value + 1)}
                className="btn btn-glass btn-sm"
              >
                <RefreshCw className="size-3.5" />
                به‌روزرسانی
              </BusyButton>
            </div>
          }
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <SearchField
            value={query}
            onChange={changeQuery}
            label="جست‌وجو در فایل‌های بازبینی"
            placeholder="نام فایل، عنوان یا دلیل…"
            busy={loading || query !== debouncedQuery}
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="فیلتر وضعیت بازبینی">
            {REVIEW_STATUSES.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => changeStatus(option.key)}
                aria-pressed={status === option.key}
                className={cn(
                  "rounded-full border px-2.5 py-1.5 text-[10px] font-bold transition-colors",
                  status === option.key
                    ? "border-violet-300/35 bg-violet-400/15 text-violet-100"
                    : "border-white/10 bg-white/[0.04] text-content-muted hover:text-white",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <StatusChip tone="neutral" className="ms-auto">
            {formatNumber(data?.total ?? 0)} فایل
          </StatusChip>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-content-faint">
          <span>آخرین دادهٔ سرور: {formatDateTime(data?.refreshedAt)}</span>
          <span>·</span>
          <span>انتخاب مقصد از کاتالوگ واقعی انجام می‌شود؛ لینک ساختگی پذیرفته نمی‌شود.</span>
        </div>
        {error ? <InlineError message={error} onRetry={() => setReload((value) => value + 1)} className="mt-3" /> : null}
      </ConsoleCard>

      <ConsoleCard className="overflow-hidden">
        <div aria-busy={loading || refreshing} className="p-2 sm:p-3">
          {loading ? (
            <LoadingRows rows={6} />
          ) : data?.items.length ? (
            <ul className="space-y-2">
              {data.items.map((file) => (
                <li key={file.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusChip tone={statusTone(file.status)}>{statusLabel(file.status)}</StatusChip>
                        <StatusChip tone="neutral">فایل #{formatNumber(file.id)}</StatusChip>
                        {file.season !== null ? <StatusChip tone="neutral">فصل {faNum(file.season)}</StatusChip> : null}
                        <StatusChip tone="violet">{file.quality || "کیفیت نامشخص"}</StatusChip>
                      </div>
                      <p className="mt-2 break-all font-mono text-[10.5px] leading-5 text-content-soft" dir="ltr">
                        {file.filename}
                      </p>
                      <p className="mt-1 text-[11.5px] font-semibold text-white" dir="auto">
                        {file.title || "بدون عنوان تشخیص‌داده‌شده"}
                        {file.episode !== null ? (
                          <span className="text-content-muted"> · قسمت {faNum(file.episode)}</span>
                        ) : (
                          <span className="text-content-faint"> · قسمت نامشخص</span>
                        )}
                        {file.size !== null ? (
                          <span className="text-content-faint"> · {formatBytes(file.size)}</span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-[10.5px] leading-6 text-content-muted">{file.reason}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <TelegramLink url={file.destinationUrl} />
                        {file.candidates.length ? (
                          <span className="text-[9.5px] text-content-faint">
                            نامزدها:{" "}
                            {file.candidates
                              .slice(0, 3)
                              .map((candidate) => `${candidate.title}${candidate.year ? ` (${faNum(candidate.year)})` : ""}`)
                              .join("، ")}
                          </span>
                        ) : (
                          <span className="text-[9.5px] text-content-faint">نامزدی از سرور برنگشته است.</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveFile(file)}
                      className="btn btn-primary btn-sm shrink-0"
                    >
                      <Link2 className="size-3.5" />
                      بررسی و اتصال
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : error ? (
            <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-[11px] leading-6 text-content-faint">
              فهرست بازبینی در دسترس نیست؛ خطای بالا را ببینید یا دوباره تلاش کنید.
            </p>
          ) : (
            <EmptyState
              title="موردی برای بازبینی نیست"
              description="با فیلتر فعلی، فایل نامطمئنی از سرور برنگشته است. داده‌ای برای پر کردن این صفحه ساخته نمی‌شود."
              action={
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setStatus("all");
                    setPage(1);
                  }}
                  className="btn btn-glass btn-sm"
                >
                  <SearchX className="size-3.5" />
                  پاک کردن فیلترها
                </button>
              }
            />
          )}
        </div>
        {data?.items.length ? (
          <div className="border-t border-white/[0.07] px-4 py-3">
            <Pager
              page={data.page}
              total={data.total}
              pageSize={data.pageSize}
              busy={loading || refreshing}
              onPage={setPage}
              label="صفحهٔ بازبینی"
            />
          </div>
        ) : null}
      </ConsoleCard>

      {activeFile ? (
        <ReviewPreviewDialog
          file={activeFile}
          session={session}
          onUnauthorized={onUnauthorized}
          notify={notify}
          onApplied={() => setReload((value) => value + 1)}
          onClose={() => setActiveFile(null)}
        />
      ) : null}
    </div>
  );
}

function ReviewPreviewDialog({
  file,
  session,
  onUnauthorized,
  notify,
  onApplied,
  onClose,
}: {
  file: AdminReviewFile;
  session: AdminSession;
  onUnauthorized: () => void;
  notify: ConsoleNotice;
  onApplied: () => void;
  onClose: () => void;
}) {
  const { canReview } = usePermissions();
  const [targetQuery, setTargetQuery] = useState(file.title || "");
  const debouncedTargetQuery = useDebouncedValue(targetQuery, 320);
  const [targets, setTargets] = useState<AdminCatalogPage | null>(null);
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetError, setTargetError] = useState("");
  const [targetSlug, setTargetSlug] = useState("");
  const [targetTitle, setTargetTitle] = useState("");
  const [episode, setEpisode] = useState(file.episode ?? 0);
  const [quality, setQuality] = useState(file.quality || "");
  const [note, setNote] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [preview, setPreview] = useState<AdminReviewPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [commandId, setCommandId] = useState<string | null>(null);
  const [commandStarted, setCommandStarted] = useState(false);
  const now = useNow(5000);
  const targetRequestRef = useRef(0);

  const { command, error: commandError } = useCommandPoll({
    commandId,
    onUnauthorized,
    onSettled: (settled) => {
      if (settled.state === "applied") {
        notify("اتصال در سرور اعمال شد", "فرمان با وضعیت «اعمال شد» پایان یافت.", "success");
        onApplied();
      } else if (settled.state === "failed") {
        notify("فرمان اتصال ناموفق بود", settled.error || "جزئیات خطا در وضعیت فرمان آمده است.", "error");
        setPreview(null);
        setConfirmed(false);
      }
    },
  });

  useEffect(() => {
    const controller = new AbortController();
    const request = ++targetRequestRef.current;
    setTargetError("");
    setTargetLoading(true);
    getCatalog(
      { query: debouncedTargetQuery, page: 1, filter: "all", targets: true },
      controller.signal,
    )
      .then((payload) => {
        if (request !== targetRequestRef.current) return;
        setTargets(payload);
      })
      .catch((failure) => {
        if (isAbortError(failure)) return;
        if (isUnauthorized(failure)) {
          onUnauthorized();
          return;
        }
        setTargetError(adminErrorMessage(failure, "جست‌وجوی مقصد ناموفق بود."));
      })
      .finally(() => {
        if (request === targetRequestRef.current) setTargetLoading(false);
      });
    return () => controller.abort();
  }, [debouncedTargetQuery, onUnauthorized]);

  const invalidatePreview = () => {
    setPreview(null);
    setConfirmed(false);
    setPreviewError("");
    setApplyError("");
  };

  const selectTarget = (slug: string, title: string) => {
    setTargetSlug(slug);
    setTargetTitle(title);
    invalidatePreview();
  };

  const requestPreview = async () => {
    if (!canReview) return;
    const trimmedNote = note.trim();
    if (!targetSlug) {
      setPreviewError("ابتدا مقصد را از کاتالوگ سرور انتخاب کنید.");
      return;
    }
    if (!Number.isInteger(episode) || episode < 1) {
      setPreviewError("شمارهٔ قسمت باید یک عدد صحیح مثبت باشد.");
      return;
    }
    if (!quality.trim()) {
      setPreviewError("کیفیت فایل باید مشخص باشد.");
      return;
    }
    if (trimmedNote.length < 5) {
      setPreviewError("یادداشت بازبینی باید حداقل ۵ نویسه باشد.");
      return;
    }
    setPreviewBusy(true);
    setPreviewError("");
    setPreview(null);
    setConfirmed(false);
    setApplyError("");
    try {
      const result = await previewReview(
        { fileId: file.id, targetSlug, episode, quality: quality.trim(), note: trimmedNote, replaceExisting },
        session.csrf,
      );
      setPreview(result);
      setCommandId(null);
      setCommandStarted(false);
      if (!result.valid || result.errors.length) {
        setPreviewError("پیش‌نمایش خطا دارد؛ تا رفع خطاها امکان تأیید وجود ندارد.");
      }
    } catch (failure) {
      if (isUnauthorized(failure)) {
        onUnauthorized();
        return;
      }
      setPreviewError(errorText(failure, "پیش‌نمایش اتصال ناموفق بود."));
    } finally {
      setPreviewBusy(false);
    }
  };

  const apply = async () => {
    if (!preview || !preview.valid || preview.errors.length || applyBusy || !confirmed) return;
    if (Date.parse(preview.expiresAt) <= now) {
      setApplyError("اعتبار پیش‌نمایش منقضی شده است؛ دوباره پیش‌نمایش بگیرید.");
      setPreview(null);
      setConfirmed(false);
      return;
    }
    setApplyBusy(true);
    setApplyError("");
    try {
      const result = await applyReview({ previewId: preview.id, confirm: true }, session.csrf);
      if (!result.commandId) {
        setApplyError("سرور فرمان را برنگرداند؛ اتصال را اعمال‌شده فرض نکنید.");
        return;
      }
      setCommandId(result.commandId);
      setCommandStarted(true);
      notify(
        "اتصال در صف ثبت شد",
        "این هنوز به معنی تطبیق نهایی نیست؛ نتیجهٔ فرمان از سرور پیگیری می‌شود.",
        "info",
      );
    } catch (failure) {
      if (isUnauthorized(failure)) {
        onUnauthorized();
        return;
      }
      setApplyError(errorText(failure, "ثبت فرمان اتصال ناموفق بود."));
    } finally {
      setApplyBusy(false);
    }
  };

  const expired = Boolean(preview && Date.parse(preview.expiresAt) <= now);
  const commandPending = command?.state === "pending" || command?.state === "running";
  const commandMeta = command ? commandStateMeta(command.state) : null;
  const inputsLocked =
    applyBusy || Boolean(commandId && (!command || commandPending));
  const canApply =
    canReview &&
    Boolean(preview) &&
    Boolean(preview?.valid) &&
    !preview?.errors.length &&
    !expired &&
    confirmed &&
    !applyBusy &&
    !commandPending &&
    !commandStarted;

  return (
    <ConsoleDialog
      open
      onClose={onClose}
      title="پیش‌نمایش و اتصال فایل"
      description="ابتدا پیش‌نمایش بگیرید؛ سپس با تأیید صریح، فرمان به صف می‌رود."
      width="lg"
      closeDisabled={applyBusy}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-[10px] text-content-faint">
            <ShieldCheck className="size-3" />
            تأیید نهایی فقط پس از پیش‌نمایش معتبر
          </span>
          <button type="button" onClick={onClose} disabled={applyBusy} className="btn btn-glass btn-sm">
            بستن
          </button>
        </div>
      }
    >
      <div className="space-y-3 pb-1">
        <section className="av-sub rounded-2xl p-3.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusChip tone={statusTone(file.status)}>{statusLabel(file.status)}</StatusChip>
            <StatusChip tone="neutral">فایل #{formatNumber(file.id)}</StatusChip>
            <StatusChip tone="violet">{file.quality || "کیفیت نامشخص"}</StatusChip>
          </div>
          <p className="mt-2 break-all font-mono text-[11px] leading-6 text-white" dir="ltr">
            {file.filename}
          </p>
          <p className="mt-1 text-[11px] leading-6 text-content-muted">
            {file.title || "بدون عنوان"}
            {file.season !== null ? ` · فصل ${faNum(file.season)}` : ""}
            {file.episode !== null ? ` · قسمت ${faNum(file.episode)}` : " · قسمت نامشخص"}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <TelegramLink url={file.destinationUrl} />
            <span className="text-[10px] text-content-faint">دلیل: {file.reason}</span>
          </div>
          {file.candidates.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="text-[9.5px] text-content-faint">نامزدهای شناسایی‌شده:</span>
              {file.candidates.map((candidate) => (
                <StatusChip key={candidate.id} tone="neutral">
                  {candidate.title}
                  {candidate.year ? ` · ${faNum(candidate.year)}` : ""}
                </StatusChip>
              ))}
            </div>
          ) : null}
        </section>

        <section className="av-sub rounded-2xl p-3.5">
          <SectionHeading
            title="مقصد در کاتالوگ"
            description="جست‌وجو از کاتالوگ واقعی سرور، شامل مقصدهای منتشرنشده برای بازبینی."
            action={
              targetSlug ? (
                <StatusChip tone="success">
                  <Check className="size-3" />
                  انتخاب‌شده
                </StatusChip>
              ) : (
                <StatusChip tone="neutral">بدون انتخاب</StatusChip>
              )
            }
          />
          <div className="mt-3">
            <SearchField
              value={targetQuery}
              onChange={(value) => {
                setTargetQuery(value);
                setTargetError("");
              }}
              label="جست‌وجوی مقصد"
              placeholder="عنوان مقصد را جست‌وجو کنید…"
              busy={targetLoading}
            />
          </div>
          {targetError ? (
            <InlineError message={targetError} className="mt-2" />
          ) : targetLoading && !targets ? (
            <div className="mt-2 space-y-1.5">
              <div className="skeleton h-10 rounded-xl" />
              <div className="skeleton h-10 rounded-xl" />
            </div>
          ) : targets?.items.length ? (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto overscroll-contain pe-1">
              {targets.items.map((item) => {
                const active = item.slug === targetSlug;
                return (
                  <li key={item.slug}>
                    <button
                      type="button"
                      onClick={() => selectTarget(item.slug, item.title || item.titleEn || item.slug)}
                      disabled={inputsLocked}
                      aria-pressed={active}
                      className={cn(
                        "flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-right transition-colors",
                        active
                          ? "border-amber-400/35 bg-amber-400/[0.08]"
                          : "border-white/[0.07] bg-white/[0.02] hover:border-violet-300/25 hover:bg-white/[0.05]",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[11.5px] font-bold text-white">
                          {item.title || item.titleEn || item.slug}
                        </span>
                        <span className="mt-0.5 block truncate text-[9.5px] text-content-faint" dir="ltr">
                          {item.slug}
                          {item.year ? ` · ${item.year}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {!item.published ? <StatusChip tone="violet">منتشرنشده</StatusChip> : null}
                        {item.hidden ? <StatusChip tone="danger">مخفی</StatusChip> : null}
                        {active ? (
                          <StatusChip tone="amber">
                            <Check className="size-2.5" />
                            مقصد
                          </StatusChip>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[10.5px] text-content-faint">
              مقصدی با این جست‌وجو برنگشت. عبارت دیگری امتحان کنید.
            </p>
          )}
          {targetSlug ? (
            <p className="mt-2 text-[10.5px] text-content-muted">
              مقصد انتخابی: <span className="font-bold text-white">{targetTitle}</span>{" "}
              <span className="font-mono text-[9.5px] text-content-faint" dir="ltr">
                ({targetSlug})
              </span>
            </p>
          ) : null}
        </section>

        <section className="av-sub rounded-2xl p-3.5">
          <SectionHeading title="مشخصات اتصال" description="قسمت و کیفیت از رکورد واقعی فایل شروع می‌شوند." />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[10.5px] font-semibold text-content-soft">قسمت</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={episode || ""}
                disabled={inputsLocked}
                onChange={(event) => {
                  setEpisode(Number(event.target.value) || 0);
                  invalidatePreview();
                }}
                className="field h-10 text-[12px] tabular-nums"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10.5px] font-semibold text-content-soft">کیفیت</span>
              <input
                value={quality}
                disabled={inputsLocked}
                onChange={(event) => {
                  setQuality(event.target.value);
                  invalidatePreview();
                }}
                className="field h-10 text-[12px]"
              />
            </label>
          </div>
          <label className="mt-3 flex items-start gap-2 text-[11px] leading-6 text-content-muted">
            <input type="checkbox" checked={replaceExisting} disabled={inputsLocked} onChange={(event) => { setReplaceExisting(event.target.checked); invalidatePreview(); }} className="mt-1 accent-amber-400" />
            <span>جایگزینی لینک آمادهٔ همین قسمت و کیفیت؛ اگر انتخاب نشود، لینک آمادهٔ قبلی حفظ می‌شود.</span>
          </label>
          <label className="mt-3 block">
            <span className="mb-1.5 flex items-center justify-between gap-2 text-[10.5px] font-semibold text-content-soft">
              <span>
                یادداشت بازبینی <span className="text-danger">*</span>
              </span>
              <span className={cn("text-[9.5px] font-normal", note.trim().length < 5 ? "text-danger" : "text-content-faint")}>
                حداقل ۵ نویسه · {faNum(note.trim().length)}
              </span>
            </span>
            <textarea
              value={note}
              disabled={inputsLocked}
              onChange={(event) => {
                setNote(event.target.value);
                invalidatePreview();
              }}
              rows={3}
              placeholder="دلیل تصمیم و شاهد اتصال را بنویسید…"
              className="field min-h-[90px] resize-y py-2.5 text-[12px] leading-6"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] leading-5 text-content-faint">
              پیش‌نمایش معتبر تا زمان اعلام‌شده قابل تأیید است و با تغییر ورودی‌ها باطل می‌شود.
            </p>
            <BusyButton
              type="button"
              busy={previewBusy}
              onClick={() => void requestPreview()}
              disabled={!canReview || inputsLocked}
              className="btn btn-primary btn-sm"
            >
              {previewBusy ? <Loader2 className="size-3.5 animate-spin" /> : <FileSearch className="size-3.5" />}
              {previewBusy ? "در حال پیش‌نمایش…" : "پیش‌نمایش"}
            </BusyButton>
          </div>
          {previewError ? <InlineError message={previewError} className="mt-2" /> : null}
        </section>

        {preview ? (
          <section className="av-enter rounded-2xl border border-violet-300/20 bg-violet-400/[0.055] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-[12px] font-black text-white">
                <Sparkles className="size-3.5 text-violet-300" />
                نتیجهٔ پیش‌نمایش
              </h3>
              <StatusChip tone={preview.valid && !preview.errors.length && !expired ? "success" : "danger"}>
                {expired ? "منقضی" : preview.valid && !preview.errors.length ? "معتبر" : "نامعتبر"}
              </StatusChip>
            </div>

            <div className="mt-2 grid gap-2 text-[10.5px] sm:grid-cols-2">
              <div className="rounded-xl border border-white/[0.07] px-2.5 py-2">
                <p className="text-content-faint">فایل مبدأ</p>
                <p className="mt-0.5 break-all font-mono text-content-soft" dir="ltr">
                  {preview.source.filename}
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.07] px-2.5 py-2">
                <p className="text-content-faint">مقصد</p>
                <p className="mt-0.5 font-bold text-white">{preview.target.title || preview.target.slug}</p>
                <p className="font-mono text-[9px] text-content-faint" dir="ltr">
                  {preview.target.slug}
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.07] px-2.5 py-2">
                <p className="text-content-faint">قسمت / کیفیت</p>
                <p className="mt-0.5 font-bold tabular-nums text-white">
                  قسمت {faNum(preview.episode)} · {preview.quality}
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.07] px-2.5 py-2">
                <p className="text-content-faint">اعتبار پیش‌نمایش</p>
                <p className="mt-0.5 flex items-center gap-1 font-bold text-content-soft">
                  <Clock3 className="size-3" />
                  {formatDateTime(preview.expiresAt)}
                </p>
              </div>
            </div>

            {preview.warnings.length ? (
              <div className="mt-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-2.5 py-2">
                <p className="flex items-center gap-1 text-[10.5px] font-bold text-amber-200">
                  <AlertTriangle className="size-3" />
                  هشدارها
                </p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-5 text-amber-100">
                  {preview.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {preview.errors.length ? (
              <div className="mt-2 rounded-xl border border-danger/30 bg-danger/10 px-2.5 py-2">
                <p className="flex items-center gap-1 text-[10.5px] font-bold text-danger">
                  <ShieldAlert className="size-3" />
                  خطاها
                </p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-5 text-danger">
                  {preview.errors.map((failure, index) => (
                    <li key={index}>{failure}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {expired ? (
              <p className="mt-2 text-[10.5px] font-semibold text-danger">
                اعتبار این پیش‌نمایش تمام شده است. دوباره پیش‌نمایش بگیرید.
              </p>
            ) : null}

            {!commandStarted ? (
              <>
                <label className="mt-3 flex items-start gap-2 rounded-xl border border-white/[0.08] bg-black/15 px-2.5 py-2 text-[10.5px] leading-5 text-content-soft">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={!preview.valid || Boolean(preview.errors.length) || expired || applyBusy}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-amber-400"
                  />
                  <span>این اتصال را بررسی کردم و می‌پذیرم که فرمان ابتدا در صف قرار می‌گیرد و تنها پس از اعمال در سرور نهایی است.</span>
                </label>
                {applyError ? <InlineError message={applyError} className="mt-2" /> : null}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[9.5px] text-content-faint">
                    پیش‌نمایش {preview.id.slice(0, 12)}…
                  </p>
                  <BusyButton
                    type="button"
                    busy={applyBusy}
                    onClick={() => void apply()}
                    disabled={!canApply}
                    className="btn btn-primary btn-sm"
                  >
                    {applyBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
                    {applyBusy ? "در حال ثبت فرمان…" : "تأیید و ثبت در صف"}
                  </BusyButton>
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        {commandStarted ? (
          <section className="av-sub rounded-2xl p-3.5" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[12px] font-black text-white">وضعیت فرمان اتصال</h3>
              {commandMeta ? <StatusChip tone={commandMeta.tone}>{commandMeta.label}</StatusChip> : <StatusChip tone="amber">در انتظار وضعیت</StatusChip>}
            </div>
            <p className="mt-1 break-all font-mono text-[9.5px] text-content-faint" dir="ltr">
              {commandId ?? "—"}
            </p>
            {command?.state === "applied" ? (
              <p className="mt-2 flex items-center gap-1.5 rounded-xl border border-success/25 bg-success/10 px-2.5 py-2 text-[10.5px] leading-5 text-success">
                <CheckCircle2 className="size-3.5 shrink-0" />
                فرمان در سرور اعمال شد؛ این اتصال اکنون نهایی است.
              </p>
            ) : command?.state === "failed" ? (
              <p className="mt-2 rounded-xl border border-danger/30 bg-danger/10 px-2.5 py-2 text-[10.5px] leading-5 text-danger">
                فرمان ناموفق بود: {command.error || commandError || "خطای نامشخص از سرور"}
              </p>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-2.5 py-2 text-[10.5px] leading-5 text-amber-200">
                <CircleDashed className={cn("size-3.5 shrink-0", commandPending && "animate-spin")} />
                در صف/در حال اجرا؛ تا پایان فرمان، اتصال را «اعمال‌شده» ندانید.
              </p>
            )}
            {commandError ? <InlineError message={commandError} className="mt-2" /> : null}
            {command?.state === "failed" ? (
              <button
                type="button"
                onClick={() => {
                  setCommandId(null);
                  setCommandStarted(false);
                  invalidatePreview();
                }}
                className="btn btn-glass btn-sm mt-2"
              >
                <X className="size-3.5" />
                پیش‌نمایش دوباره
              </button>
            ) : null}
          </section>
        ) : null}

        {!canReview ? <InlineError message="نقش فعلی اجازهٔ بازبینی ندارد." /> : null}
      </div>
    </ConsoleDialog>
  );
}
