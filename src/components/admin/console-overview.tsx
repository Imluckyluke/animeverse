"use client";

import type { AdminOverview } from "@/lib/admin-contract";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  ArrowUpLeft,
  Boxes,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Database,
  HardDriveDownload,
  Layers3,
  PackageCheck,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import {
  commandStateMeta,
  formatBytes,
  formatDateTime,
  formatNumber,
  InlineError,
  SectionHeading,
  StatusChip,
} from "@/components/admin/console-ui";

const PUBLICATION_LABELS: Record<string, string> = {
  published: "منتشرشده",
  ready: "آماده",
  pending: "در انتظار انتشار",
  publishing: "در حال انتشار",
  failed: "انتشار ناموفق",
  stale: "قدیمی",
  never: "هنوز منتشر نشده",
  idle: "بی‌کار",
};

const SERVICE_LABELS: Record<string, { label: string; tone: "success" | "amber" | "danger" | "neutral" | "violet" }> = {
  running: { label: "در حال اجرا", tone: "success" },
  ready: { label: "آماده", tone: "success" },
  online: { label: "آنلاین", tone: "success" },
  ok: { label: "سالم", tone: "success" },
  healthy: { label: "سالم", tone: "success" },
  idle: { label: "بی‌کار", tone: "neutral" },
  starting: { label: "در حال شروع", tone: "amber" },
  pending: { label: "در انتظار", tone: "amber" },
  degraded: { label: "کاهش کیفیت", tone: "amber" },
  offline: { label: "آفلاین", tone: "danger" },
  down: { label: "از دسترس خارج", tone: "danger" },
  error: { label: "خطا", tone: "danger" },
  failed: { label: "ناموفق", tone: "danger" },
};

const CACHE_LABELS: Record<string, string> = {
  hot: "داغ",
  temp: "موقت",
  active: "فعال",
  queued: "در صف",
  pending: "در انتظار",
  copying: "در حال کپی",
  ready: "آماده",
  missing: "ناموجود",
  failed: "ناموفق",
  stale: "قدیمی",
};

function publicationMeta(state: string) {
  if (state === "published" || state === "ready") return { label: PUBLICATION_LABELS[state], tone: "success" as const };
  if (state === "failed") return { label: PUBLICATION_LABELS[state], tone: "danger" as const };
  if (state === "publishing") return { label: PUBLICATION_LABELS[state], tone: "violet" as const };
  if (state === "pending") return { label: PUBLICATION_LABELS[state], tone: "amber" as const };
  return { label: PUBLICATION_LABELS[state] ?? state ?? "نامشخص", tone: "neutral" as const };
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  accent = false,
}: {
  icon: typeof Boxes;
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="av-sub rounded-2xl px-3.5 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold text-content-muted">{label}</span>
        <Icon className={cn("size-3.5", accent ? "text-amber-300" : "text-violet-300/80")} />
      </div>
      <p className="mt-1.5 text-xl font-black tabular-nums text-white">{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] text-content-faint">{hint}</p> : null}
    </div>
  );
}

export function OverviewPanel({
  overview,
  loading,
  error,
  lastLoadedAt,
  refreshing,
  onRefresh,
  onOpenCatalog,
  onOpenReview,
  onOpenDownloads,
}: {
  overview: AdminOverview | null;
  loading: boolean;
  error: string;
  lastLoadedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenCatalog: () => void;
  onOpenReview: () => void;
  onOpenDownloads: () => void;
}) {
  if (loading && !overview && !error) {
    return (
      <div className="space-y-3" role="status" aria-label="در حال دریافت نمای کلی">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-3xl" />
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-3xl" />
          <Skeleton className="h-64 rounded-3xl" />
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="space-y-3">
        <InlineError message={error || "نمای کلی در دسترس نیست."} onRetry={onRefresh} />
      </div>
    );
  }

  const publication = publicationMeta(overview.publication.state);
  const cacheEntries = Object.entries(overview.cache.states ?? {}).sort((a, b) => b[1] - a[1]);
  const cacheRatio =
    overview.cache.capacity > 0
      ? Math.max(0, Math.min(1, overview.cache.active / overview.cache.capacity))
      : 0;

  return (
    <div className="space-y-3">
      {error ? (
        <InlineError message={`${error} — دادهٔ نمایش‌داده‌شده از آخرین دریافت موفق است.`} onRetry={onRefresh} />
      ) : null}

      <section className="av-card relative overflow-hidden rounded-3xl p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-16 -top-24 size-64 rounded-full bg-[radial-gradient(closest-side,rgba(124,82,211,.28),transparent)]"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow">خلاصهٔ وضعیت</span>
              <StatusChip tone={publication.tone}>{publication.label}</StatusChip>
            </div>
            <h2 className="mt-2 text-xl font-black text-white sm:text-2xl">
              {formatNumber(overview.inventory.titles)} عنوان در آرشیو
            </h2>
            <p className="mt-1 max-w-xl text-[11.5px] leading-6 text-content-muted">
              محتوا را ویرایش کن، فایل‌ها را بررسی کن و تغییرات آماده را منتشر کن.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="btn btn-glass btn-sm"
            >
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
              {refreshing ? "در حال دریافت…" : "به‌روزرسانی"}
            </button>
            <p className="text-[10px] text-content-faint" aria-live="polite">
              {lastLoadedAt ? `آخرین دریافت: ${timeAgo(new Date(lastLoadedAt).toISOString())}` : "هنوز دریافت نشده"}
              {" · "}
              ساعت سرور: {formatDateTime(overview.serverNow)}
            </p>
          </div>
        </div>

        <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat icon={Layers3} label="عنوان‌ها" value={formatNumber(overview.inventory.titles)} />
          <Stat icon={Boxes} label="قسمت‌ها" value={formatNumber(overview.inventory.episodes)} />
          <Stat icon={Sparkles} label="کیفیت‌ها" value={formatNumber(overview.inventory.qualities)} />
          <Stat
            icon={PackageCheck}
            label="کپی‌شده"
            value={formatNumber(overview.inventory.copied)}
            hint={`${formatNumber(overview.inventory.pending)} در انتظار`}
          />
        </div>
      </section>

      <div className="grid gap-2 sm:grid-cols-3" aria-label="کارهای روزمره">
        <button className="av-card rounded-2xl p-4 text-start transition-colors hover:border-amber-400/40" onClick={onOpenCatalog}><span className="block text-sm font-bold">مدیریت انیمه‌ها</span><span className="mt-1 block text-[11px] text-content-muted">ویرایش اطلاعات، تصویر و قسمت‌ها</span></button>
        <button className="av-card rounded-2xl p-4 text-start transition-colors hover:border-amber-400/40" onClick={onOpenReview}><span className="block text-sm font-bold">بررسی فایل‌ها</span><span className="mt-1 block text-[11px] text-content-muted">تطبیق فایل‌های آماده با عنوان درست</span></button>
        <button className="av-card rounded-2xl p-4 text-start transition-colors hover:border-amber-400/40" onClick={onOpenDownloads}><span className="block text-sm font-bold">وضعیت دانلودها</span><span className="mt-1 block text-[11px] text-content-muted">پیگیری درخواست‌ها و ظرفیت</span></button>
      </div>
      <details className="av-card rounded-3xl p-4 sm:p-5">
        <summary className="cursor-pointer text-sm font-bold text-content-soft">جزئیات عملیات، انتشار و سرویس‌ها</summary>
        <div className="mt-4 space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="av-card rounded-3xl p-4 sm:p-5">
          <SectionHeading
            icon={<ShieldAlert className="size-4" />}
            title="انتشار عمومی"
            description="وضعیت استقرار عمومی و تغییرات در انتظار."
            action={
              <StatusChip tone={publication.tone}>{publication.label}</StatusChip>
            }
          />
          <dl className="mt-4 grid grid-cols-2 gap-2">
            <div className="av-sub rounded-2xl px-3 py-3">
              <dt className="text-[10px] text-content-faint">تغییرات در انتظار</dt>
              <dd className="mt-1 text-lg font-black tabular-nums text-white">
                {formatNumber(overview.publication.pendingChanges)}
              </dd>
            </div>
            <div className="av-sub rounded-2xl px-3 py-3">
              <dt className="text-[10px] text-content-faint">تعداد کاتالوگ منتشرشده</dt>
              <dd className="mt-1 text-lg font-black tabular-nums text-white">
                {formatNumber(overview.publication.catalogCount)}
              </dd>
            </div>
            <div className="av-sub col-span-2 rounded-2xl px-3 py-3">
              <dt className="text-[10px] text-content-faint">آخرین انتشار</dt>
              <dd className="mt-1 text-[12px] font-semibold text-content-soft">
                {formatDateTime(overview.publication.publishedAt)}
              </dd>
            </div>
          </dl>
          {overview.publication.lastError ? (
            <p
              role="alert"
              className="mt-2 flex items-start gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-[11px] leading-6 text-danger"
            >
              <AlertTriangle className="mt-1 size-3.5 shrink-0" />
              <span>{overview.publication.lastError}</span>
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button type="button" onClick={onOpenCatalog} className="btn btn-glass btn-sm">
              کاتالوگ
            </button>
            <button type="button" onClick={onOpenReview} className="btn btn-glass btn-sm">
              بازبینی آرشیو
            </button>
            <button type="button" onClick={onOpenDownloads} className="btn btn-glass btn-sm">
              کش و فرمان‌ها
            </button>
          </div>
        </section>

        <section className="av-card rounded-3xl p-4 sm:p-5">
          <SectionHeading
            icon={<Database className="size-4" />}
            title="کش و فضای کاری"
            description="ظرفیت و وضعیت‌های گزارش‌شده توسط سرور."
          />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="av-sub rounded-2xl px-3 py-3">
              <p className="text-[10px] text-content-faint">فعال / ظرفیت</p>
              <p className="mt-1 text-[13px] font-black tabular-nums text-white">
                {formatNumber(overview.cache.active)} / {formatNumber(overview.cache.capacity)}
              </p>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={Math.max(0, overview.cache.capacity)}
                aria-valuenow={Math.min(Math.max(0, overview.cache.active), Math.max(0, overview.cache.capacity))}
                aria-label="نسبت ظرفیت فعال کش"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-l from-violet-400 to-amber-300"
                  style={{ width: `${cacheRatio * 100}%` }}
                />
              </div>
            </div>
            <div className="av-sub rounded-2xl px-3 py-3">
              <p className="text-[10px] text-content-faint">فضای داغ / موقت</p>
              <p className="mt-1 text-[12px] font-black tabular-nums text-white">
                {formatBytes(overview.cache.bytes.hot)}
              </p>
              <p className="mt-1 text-[11px] text-content-muted">{formatBytes(overview.cache.bytes.temp)}</p>
            </div>
          </div>
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="وضعیت‌های کش">
            {cacheEntries.length ? (
              cacheEntries.map(([state, count]) => (
                <li key={state}>
                  <StatusChip tone={state === "failed" ? "danger" : state === "active" ? "amber" : "neutral"}>
                    {CACHE_LABELS[state] ?? state}
                    <span className="tabular-nums text-white">{formatNumber(count)}</span>
                  </StatusChip>
                </li>
              ))
            ) : (
              <li className="text-[11px] text-content-faint">وضعیت کشی گزارش نشده است.</li>
            )}
          </ul>
        </section>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="av-card rounded-3xl p-4 sm:p-5">
          <SectionHeading
            icon={<Users className="size-4" />}
            title="حساب‌های کاربری"
            description="حساب‌های واقعی ثبت‌شده در سرور."
          />
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat icon={Users} label="کل" value={formatNumber(overview.accounts.total)} />
            <Stat icon={Sparkles} label="علاقه‌مندی‌ها" value={formatNumber(overview.accounts.favorites)} />
            <Stat icon={CircleDashed} label="غیرفعال" value={formatNumber(overview.accounts.disabled)} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <StatusChip tone="neutral">حساب‌های محلی مرورگر در این آمار نیستند</StatusChip>
          </div>
        </section>

        <section className="av-card rounded-3xl p-4 sm:p-5">
          <SectionHeading
            icon={<Activity className="size-4" />}
            title="سرویس‌ها"
            description="آخرین وضعیت اعلام‌شده برای هر سرویس."
          />
          <ul className="mt-3 space-y-2">
            {overview.services.length ? (
              overview.services.map((service) => {
                const meta =
                  SERVICE_LABELS[service.state] ?? {
                    label: service.state || "نامشخص",
                    tone: "neutral" as const,
                  };
                return (
                  <li
                    key={service.name}
                    className="av-sub flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-bold text-white">{service.label}</p>
                      <p className="mt-0.5 text-[10px] text-content-faint" dir="ltr">
                        {service.name}
                        {service.updatedAt ? ` · ${formatDateTime(service.updatedAt)}` : ""}
                      </p>
                    </div>
                    <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
                  </li>
                );
              })
            ) : (
              <li className="rounded-2xl border border-dashed border-white/10 px-3 py-5 text-center text-[11px] text-content-faint">
                سرویسی گزارش نشده است.
              </li>
            )}
          </ul>
        </section>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="av-card rounded-3xl p-4 sm:p-5">
          <SectionHeading
            icon={<Clock3 className="size-4" />}
            title="فرمان‌های اخیر"
            description="فرمان‌های در صف، در حال اجرا و پایان‌یافته."
            action={<StatusChip tone="neutral">{formatNumber(overview.commands.length)} مورد</StatusChip>}
          />
          <ul className="mt-3 space-y-2">
            {overview.commands.length ? (
              overview.commands.map((command) => {
                const meta = commandStateMeta(command.state);
                return (
                  <li key={command.id} className="av-sub rounded-2xl px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11.5px] font-bold text-white">{command.kind}</span>
                      <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-content-faint">
                      <span dir="ltr" className="font-mono">
                        {command.id}
                      </span>
                      <span>ایجاد: {formatDateTime(command.createdAt)}</span>
                      {command.finishedAt ? <span>پایان: {formatDateTime(command.finishedAt)}</span> : null}
                    </div>
                    {command.error ? (
                      <p className="mt-1.5 text-[10.5px] leading-5 text-danger">{command.error}</p>
                    ) : command.state === "applied" ? (
                      <p className="mt-1.5 flex items-center gap-1 text-[10px] text-success">
                        <CheckCircle2 className="size-3" />
                        نتیجه در سرور اعمال شده است.
                      </p>
                    ) : null}
                  </li>
                );
              })
            ) : (
              <li className="rounded-2xl border border-dashed border-white/10 px-3 py-5 text-center text-[11px] text-content-faint">
                فرمانی ثبت نشده است.
              </li>
            )}
          </ul>
        </section>

        <section className="av-card rounded-3xl p-4 sm:p-5">
          <SectionHeading
            icon={<HardDriveDownload className="size-4" />}
            title="فعالیت اخیر"
            description="رویدادهای قابل ردیابی در تاریخچهٔ مدیریت."
            action={
              <button type="button" onClick={onOpenDownloads} className="btn btn-ghost btn-sm">
                جزئیات
                <ArrowUpLeft className="size-3.5" />
              </button>
            }
          />
          <ul className="mt-3 space-y-2">
            {overview.activity.length ? (
              overview.activity.map((event) => (
                <li key={event.id} className="av-sub flex gap-2.5 rounded-2xl px-3 py-2.5">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-300" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-semibold leading-6 text-content-soft">{event.summary}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-content-faint">
                      <span>{event.actor}</span>
                      <span dir="auto">· {event.target}</span>
                      <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                    </p>
                  </div>
                  {event.reversible ? <StatusChip tone="violet">قابل بازگردانی</StatusChip> : null}
                </li>
              ))
            ) : (
              <li className="rounded-2xl border border-dashed border-white/10 px-3 py-5 text-center text-[11px] text-content-faint">
                فعالیتی ثبت نشده است.
              </li>
            )}
          </ul>
        </section>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={CircleDashed} label="در انتظار پردازش" value={formatNumber(overview.inventory.pending)} />
        <Stat icon={AlertTriangle} label="بدون تطبیق" value={formatNumber(overview.inventory.unmatched)} />
        <Stat icon={ShieldAlert} label="نگه‌داشته‌شده" value={formatNumber(overview.inventory.held)} />
        <Stat
          icon={CheckCircle2}
          label="کیفیت آماده"
          value={formatNumber(overview.inventory.qualities)}
        />
      </div>
        </div>
      </details>
    </div>
  );
}
