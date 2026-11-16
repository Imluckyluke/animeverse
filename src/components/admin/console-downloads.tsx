"use client";

import type { AdminOverview } from "@/lib/admin-contract";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, faNum } from "@/lib/utils";
import {
  Activity,
  CircleDashed,
  Clock3,
  Database,
  HardDriveDownload,
  Info,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  ConsoleCard,
  InlineError,
  SectionHeading,
  StatusChip,
  commandStateMeta,
  formatBytes,
  formatDateTime,
  formatNumber,
} from "@/components/admin/console-ui";

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

export function DownloadsPanel({
  overview,
  error,
  loading,
  refreshing,
  onRefresh,
}: {
  overview: AdminOverview | null;
  error: string;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  if (!overview) {
    return (
      <div className="space-y-3">
        {error ? (
          <>
            <InlineError message={error} onRetry={onRefresh} />
            <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-[11px] text-content-faint">
              پس از دریافت موفق نمای کلی، کش و فرمان‌ها اینجا نمایش داده می‌شوند.
            </p>
          </>
        ) : loading ? (
          <>
            <Skeleton className="h-40 rounded-3xl" />
            <Skeleton className="h-72 rounded-3xl" />
          </>
        ) : (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-[11px] leading-6 text-content-faint">
            نمای کلی هنوز دریافت نشده است؛ برای نمایش کش و فرمان‌ها تازه‌سازی کنید.
          </p>
        )}
      </div>
    );
  }

  const cacheEntries = Object.entries(overview.cache.states ?? {}).sort((a, b) => b[1] - a[1]);
  const commandCounts = overview.commands.reduce<Record<string, number>>((accumulator, command) => {
    accumulator[command.state] = (accumulator[command.state] ?? 0) + 1;
    return accumulator;
  }, {});
  const ratio =
    overview.cache.capacity > 0
      ? Math.max(0, Math.min(1, overview.cache.active / overview.cache.capacity))
      : 0;

  return (
    <div className="space-y-3">
      {error ? (
        <InlineError
          message={`${error} — آخرین دادهٔ معتبر نمایش داده می‌شود.`}
          onRetry={onRefresh}
        />
      ) : null}

      <ConsoleCard className="p-4 sm:p-5">
        <SectionHeading
          icon={<HardDriveDownload className="size-4" />}
          title="کش دانلود و فضای کاری"
          description="همهٔ اعداد از وضعیت واقعی سرور می‌آیند؛ این صفحه فرمان اجرا، لغو یا تلاش دوباره نمی‌سازد."
          action={
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="btn btn-glass btn-sm"
            >
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
              {refreshing ? "در حال دریافت…" : "به‌روزرسانی"}
            </button>
          }
        />
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="av-sub rounded-2xl px-3.5 py-3">
            <p className="flex items-center gap-1.5 text-[10px] text-content-faint">
              <Activity className="size-3" />
              فعال / ظرفیت
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-white">
              {formatNumber(overview.cache.active)} / {formatNumber(overview.cache.capacity)}
            </p>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, overview.cache.capacity)}
              aria-valuenow={Math.min(overview.cache.active, Math.max(0, overview.cache.capacity))}
              aria-label="نسبت کش فعال به ظرفیت"
            >
              <div
                className="h-full rounded-full bg-gradient-to-l from-violet-400 to-amber-300"
                style={{ width: `${ratio * 100}%` }}
              />
            </div>
          </div>
          <div className="av-sub rounded-2xl px-3.5 py-3">
            <p className="flex items-center gap-1.5 text-[10px] text-content-faint">
              <Database className="size-3" />
              فضای داغ
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-white">
              {formatBytes(overview.cache.bytes.hot)}
            </p>
            <p className="mt-1 text-[10px] text-content-faint">دادهٔ مستقیم سرور</p>
          </div>
          <div className="av-sub rounded-2xl px-3.5 py-3">
            <p className="flex items-center gap-1.5 text-[10px] text-content-faint">
              <Database className="size-3" />
              فضای موقت
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-white">
              {formatBytes(overview.cache.bytes.temp)}
            </p>
            <p className="mt-1 text-[10px] text-content-faint">دادهٔ مستقیم سرور</p>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-white/[0.07] bg-black/10 p-3">
          <p className="text-[10.5px] font-semibold text-content-soft">حالت‌های گزارش‌شدهٔ کش</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {cacheEntries.length ? (
              cacheEntries.map(([state, count]) => (
                <li key={state}>
                  <StatusChip
                    tone={
                      state === "failed"
                        ? "danger"
                        : state === "active"
                          ? "amber"
                          : state === "ready"
                            ? "success"
                            : "neutral"
                    }
                  >
                    {CACHE_LABELS[state] ?? state}
                    <span className="tabular-nums text-white">{formatNumber(count)}</span>
                  </StatusChip>
                </li>
              ))
            ) : (
              <li className="text-[10.5px] text-content-faint">سرور حالت کشی برنگردانده است.</li>
            )}
          </ul>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-5 text-content-faint">
          <Info className="mt-0.5 size-3 shrink-0" />
          ساعت سرور: {formatDateTime(overview.serverNow)}. تلاش دوباره یا لغو دستی فقط از جریان‌های مجاز سرور انجام
          می‌شود و در این رابط دکمه‌ای برای آن وجود ندارد.
        </p>
      </ConsoleCard>

      <ConsoleCard className="overflow-hidden">
        <div className="p-4 pb-0 sm:p-5 sm:pb-0">
          <SectionHeading
            icon={<ShieldCheck className="size-4" />}
            title="فرمان‌ها"
            description="فرمان در صف با فرمان اعمال‌شده یکی نیست؛ وضعیت نهایی از سرور خوانده می‌شود."
            action={
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(commandCounts).length ? (
                  Object.entries(commandCounts).map(([state, count]) => {
                    const meta = commandStateMeta(state);
                    return (
                      <StatusChip key={state} tone={meta.tone}>
                        {meta.label} {faNum(count)}
                      </StatusChip>
                    );
                  })
                ) : (
                  <StatusChip tone="neutral">بدون فرمان</StatusChip>
                )}
              </div>
            }
          />
        </div>
        <div className="p-3 sm:p-4">
          {overview.commands.length ? (
            <ul className="space-y-2">
              {overview.commands.map((command) => {
                const meta = commandStateMeta(command.state);
                return (
                  <li key={command.id} className="av-sub rounded-2xl p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[12px] font-bold text-white">{command.kind}</span>
                      <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
                    </div>
                    <p className="mt-1 break-all font-mono text-[9.5px] text-content-faint" dir="ltr">
                      {command.id}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-content-faint">
                      <span className="flex items-center gap-1">
                        <Clock3 className="size-3" />
                        ایجاد: {formatDateTime(command.createdAt)}
                      </span>
                      {command.finishedAt ? <span>پایان: {formatDateTime(command.finishedAt)}</span> : null}
                    </div>
                    {command.error ? (
                      <p className="mt-1.5 rounded-xl border border-danger/25 bg-danger/10 px-2.5 py-2 text-[10px] leading-5 text-danger">
                        {command.error}
                      </p>
                    ) : command.state === "pending" || command.state === "running" ? (
                      <p className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-200">
                        <CircleDashed className={cn("size-3", command.state === "running" && "animate-spin")} />
                        در انتظار نتیجهٔ نهایی سرور
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center">
              <p className="text-[11.5px] font-bold text-white">فرمانی در سرور ثبت نشده است</p>
              <p className="mt-1 text-[10.5px] leading-5 text-content-faint">
                پس از انتشار یا بازبینی، فرمان واقعی در همین فهرست دیده می‌شود.
              </p>
            </div>
          )}
        </div>
      </ConsoleCard>
    </div>
  );
}
