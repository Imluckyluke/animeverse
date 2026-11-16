"use client";

import type { AdminEvent, AdminHistoryPage, AdminSession } from "@/lib/admin-contract";
import {
  adminErrorMessage,
  getHistory,
  isAbortError,
  isUnauthorized,
  undoEvent,
} from "@/lib/admin-client";
import {
  History,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BusyButton,
  ConfirmDialog,
  ConsoleCard,
  EmptyState,
  InlineError,
  LoadingRows,
  Pager,
  SectionHeading,
  StatusChip,
  errorText,
  formatDateTime,
  formatNumber,
  usePermissions,
  type ConsoleNotice,
} from "@/components/admin/console-ui";

export function HistoryPanel({
  session,
  onUnauthorized,
  notify,
}: {
  session: AdminSession;
  onUnauthorized: () => void;
  notify: ConsoleNotice;
}) {
  const { canUndo } = usePermissions();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminHistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [active, setActive] = useState<AdminEvent | null>(null);
  const [note, setNote] = useState("");
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const request = ++requestRef.current;
    setError("");
    if (data?.items.length) setRefreshing(true);
    else setLoading(true);
    getHistory(page, controller.signal)
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
        setError(adminErrorMessage(failure, "تاریخچهٔ مدیریت دریافت نشد."));
      })
      .finally(() => {
        if (request !== requestRef.current) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, reload, onUnauthorized]);

  const confirmUndo = async () => {
    if (!active || note.trim().length < 5) return;
    setUndoBusy(true);
    setUndoError("");
    try {
      await undoEvent(active.id, { confirm: true, note: note.trim() }, session.csrf);
      notify(
        "رویداد بازگردانی شد",
        "نتیجهٔ بازگردانی در سرور ثبت شد؛ فهرست از سرور تازه می‌شود.",
        "success",
      );
      setActive(null);
      setNote("");
      setReload((value) => value + 1);
    } catch (failure) {
      if (isUnauthorized(failure)) {
        onUnauthorized();
        return;
      }
      setUndoError(errorText(failure, "بازگردانی رویداد ناموفق بود."));
    } finally {
      setUndoBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <ConsoleCard className="p-4 sm:p-5">
        <SectionHeading
          icon={<History className="size-4" />}
          title="تاریخچه و بازگردانی"
          description="رویدادهای واقعی دفتر مدیریت. بازگردانی فقط برای رویدادهای علامت‌خورده و با یادداشت انجام می‌شود."
          action={
            <BusyButton
              type="button"
              busy={refreshing}
              onClick={() => setReload((value) => value + 1)}
              className="btn btn-glass btn-sm"
            >
              <RefreshCw className="size-3.5" />
              به‌روزرسانی
            </BusyButton>
          }
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <StatusChip tone="neutral">{formatNumber(data?.total ?? 0)} رویداد</StatusChip>
          {!canUndo ? (
            <span className="flex items-center gap-1 text-[10px] text-content-faint">
              <ShieldCheck className="size-3" />
              بازگردانی رویداد فقط برای نقش مالک فعال است.
            </span>
          ) : null}
        </div>
        {error ? <InlineError message={error} onRetry={() => setReload((value) => value + 1)} className="mt-3" /> : null}
      </ConsoleCard>

      <ConsoleCard className="overflow-hidden">
        <div aria-busy={loading || refreshing} className="p-2 sm:p-3">
          {loading ? (
            <LoadingRows rows={7} />
          ) : data?.items.length ? (
            <ul className="space-y-2">
              {data.items.map((event) => (
                <li key={event.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusChip tone="violet">{event.action}</StatusChip>
                        {event.reversible ? (
                          <StatusChip tone="success">
                            <RotateCcw className="size-2.5" />
                            قابل بازگردانی
                          </StatusChip>
                        ) : (
                          <StatusChip tone="neutral">غیرقابل بازگردانی</StatusChip>
                        )}
                        <span className="text-[9.5px] text-content-faint">رویداد #{formatNumber(event.id)}</span>
                      </div>
                      <p className="mt-2 text-[11.5px] font-semibold leading-6 text-content-soft">{event.summary}</p>
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-content-faint">
                        <span>کنشگر: {event.actor}</span>
                        <span dir="auto">هدف: {event.target}</span>
                        <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                      </p>
                    </div>
                    {event.reversible && canUndo ? (
                      <button
                        type="button"
                        onClick={() => {
                          setNote("");
                          setUndoError("");
                          setActive(event);
                        }}
                        className="btn btn-glass btn-sm shrink-0"
                      >
                        <Undo2 className="size-3.5" />
                        بازگردانی
                      </button>
                    ) : event.reversible ? (
                      <span className="shrink-0 text-[9.5px] text-content-faint">نیازمند نقش مالک</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : error ? (
            <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-[11px] leading-6 text-content-faint">
              تاریخچه در دسترس نیست؛ خطای بالا را ببینید یا دوباره تلاش کنید.
            </p>
          ) : (
            <EmptyState
              title="رویدادی ثبت نشده است"
              description="دفتر تاریخچه از سرور خالی برگشته است؛ ردیف ساختگی ایجاد نمی‌شود."
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
              label="صفحهٔ تاریخچه"
            />
          </div>
        ) : null}
      </ConsoleCard>

      <ConfirmDialog
        open={Boolean(active)}
        onClose={() => {
          if (!undoBusy) {
            setActive(null);
            setUndoError("");
          }
        }}
        onConfirm={() => void confirmUndo()}
        title="بازگردانی رویداد"
        description="این عمل از سرور درخواست بازگردانی می‌کند و ممکن است روی دادهٔ فعلی اثر بگذارد."
        confirmLabel="بازگردانی"
        tone="danger"
        busy={undoBusy}
        error={undoError}
        note={{
          value: note,
          onChange: (value) => {
            setNote(value);
            setUndoError("");
          },
          label: "یادداشت بازگردانی",
          placeholder: "دلیل بازگردانی را بنویسید…",
          required: true,
          minLength: 5,
          hint: "حداقل ۵ نویسه؛ همراه رویداد در تاریخچه ثبت می‌شود.",
        }}
      >
        {active ? (
          <div className="av-sub rounded-2xl px-3 py-2.5 text-[11px] leading-6 text-content-muted">
            <p className="font-bold text-white">{active.summary}</p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
              <span>کنشگر: {active.actor}</span>
              <span dir="auto">هدف: {active.target}</span>
              <span>{formatDateTime(active.at)}</span>
            </p>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
