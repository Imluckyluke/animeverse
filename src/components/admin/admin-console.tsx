"use client";

import Link from "next/link";
import type { AdminOverview, AdminSession } from "@/lib/admin-contract";
import {
  adminErrorMessage,
  clearLegacyAdminKey,
  getOverview,
  getSession,
  isAbortError,
  isUnauthorized,
  login,
  logout,
  publish,
  readLegacyAdminKey,
} from "@/lib/admin-client";
import { cn, faNum } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  Clock3,
  Eye,
  HardDriveDownload,
  History,
  Info,
  LayoutDashboard,
  LibraryBig,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CatalogPanel } from "@/components/admin/console-catalog";
import { DownloadsPanel } from "@/components/admin/console-downloads";
import { HistoryPanel } from "@/components/admin/console-history";
import { OverviewPanel } from "@/components/admin/console-overview";
import { ReviewPanel } from "@/components/admin/console-review";
import { SettingsPanel } from "@/components/admin/console-settings";
import {
  ConfirmDialog,
  ConsoleCard,
  ConsoleSkin,
  InlineError,
  PermissionsProvider,
  RoleBadge,
  StatusChip,
  commandStateMeta,
  formatDateTime,
  permissionsFor,
  useCommandPoll,
  type ConsoleNotice,
} from "@/components/admin/console-ui";
import { UsersPanel } from "@/components/admin/console-users";

type TabKey = "overview" | "catalog" | "review" | "downloads" | "users" | "history" | "settings";
type NoticeTone = "success" | "error" | "info";

const TABS: {
  key: TabKey;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
  ownerOnly?: boolean;
}[] = [
  {
    key: "overview",
    label: "نمای کلی",
    description: "خلاصهٔ وضعیت و دسترسی سریع به کارهای روزمره.",
    icon: LayoutDashboard,
  },
  {
    key: "catalog",
    label: "انیمه‌ها",
    description: "جست‌وجو و ویرایش اطلاعات، تصویر و قسمت‌ها.",
    icon: LibraryBig,
  },
  {
    key: "review",
    label: "بررسی فایل‌ها",
    description: "پیش‌نمایش و تأیید اتصال هر فایل به عنوان درست.",
    icon: ClipboardCheck,
  },
  {
    key: "downloads",
    label: "دانلودها",
    description: "پیگیری درخواست‌ها، وضعیت فایل‌ها و ظرفیت.",
    icon: HardDriveDownload,
  },
  {
    key: "users",
    label: "کاربران",
    description: "مدیریت حساب‌ها و دسترسی کاربران.",
    icon: Users,
    ownerOnly: true,
  },
  {
    key: "history",
    label: "تاریخچه",
    description: "مشاهدهٔ تغییرات و بازگردانی موارد پشتیبانی‌شده.",
    icon: History,
  },
  {
    key: "settings",
    label: "تنظیمات",
    description: "انتشار، امنیت حساب، ظرفیت و نسخه‌های پشتیبان.",
    icon: Settings,
    ownerOnly: true,
  },
];

type AuthState = "loading" | "signed-out" | "ready";
type NoticeItem = { id: number; title: string; description?: string; tone: NoticeTone };

export function AdminConsole() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [session, setSession] = useState<AdminSession | null>(null);
  const [sessionMessage, setSessionMessage] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [sessionReload, setSessionReload] = useState(0);
  const [tab, setTab] = useState<TabKey>("overview");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewRefreshing, setOverviewRefreshing] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [overviewLoadedAt, setOverviewLoadedAt] = useState<number | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishCommandId, setPublishCommandId] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeItem | null>(null);
  const overviewRequest = useRef<AbortController | null>(null);
  const overviewRef = useRef<AdminOverview | null>(null);
  const noticeTimer = useRef<number | null>(null);

  const permissions = useMemo(
    () => permissionsFor(session?.user.role ?? "reviewer"),
    [session?.user.role],
  );

  const notify = useCallback<ConsoleNotice>((title, description, tone = "success") => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice({ id: Date.now(), title, description, tone });
    noticeTimer.current = window.setTimeout(() => setNotice(null), tone === "error" ? 9000 : 6500);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const handleUnauthorized = useCallback(() => {
    setSession(null);
    setAuthState("signed-out");
    setSessionMessage("نشست مدیریت معتبر نیست یا منقضی شده است؛ دوباره وارد شوید.");
    overviewRef.current = null;
    setOverview(null);
    setOverviewLoadedAt(null);
    setOverviewError("");
    setPublishCommandId(null);
    setPublishOpen(false);
    setTab("overview");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setAuthState("loading");
    setSessionError("");
    getSession(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        if (next) {
          setSession(next);
          setAuthState("ready");
          setSessionMessage("");
        } else {
          setSession(null);
          setAuthState("signed-out");
        }
      })
      .catch((failure) => {
        if (isAbortError(failure) || controller.signal.aborted) return;
        setSession(null);
        setAuthState("signed-out");
        setSessionError(adminErrorMessage(failure, "ارتباط با سرور مدیریت برقرار نشد."));
      });
    return () => controller.abort();
  }, [sessionReload]);

  const handleAuthenticated = useCallback((next: AdminSession) => {
    setSession(next);
    setAuthState("ready");
    setSessionMessage("");
    setSessionError("");
    overviewRef.current = null;
    setOverview(null);
    setOverviewLoadedAt(null);
    setOverviewError("");
    setTab("overview");
  }, []);

  const invalidateSession = useCallback((reason: string) => {
    setSession(null);
    setAuthState("signed-out");
    setSessionMessage(reason);
    overviewRef.current = null;
    setOverview(null);
    setOverviewLoadedAt(null);
    setPublishCommandId(null);
    setTab("overview");
  }, []);

  useEffect(() => {
    if (!session) return;
    const expires = Date.parse(session.expiresAt);
    if (!Number.isFinite(expires)) return;
    let timer = 0;
    const check = () => {
      const left = expires - Date.now();
      if (left <= 0) {
        handleUnauthorized();
        return;
      }
      timer = window.setTimeout(check, Math.min(left + 200, 2147483647));
    };
    check();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(timer);
        check();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session, handleUnauthorized]);

  useEffect(() => {
    if (!session) return;
    const allowed = TABS.find((entry) => entry.key === tab);
    if (allowed?.ownerOnly && !permissions.canManageUsers) setTab("overview");
  }, [session, tab, permissions.canManageUsers]);

  const loadOverview = useCallback(
    async (manual = false) => {
      if (!session) return;
      // A manual refresh supersedes a poll; two overview requests never overlap.
      overviewRequest.current?.abort();
      const controller = new AbortController();
      overviewRequest.current = controller;
      if (manual) setOverviewRefreshing(true);
      else if (!overviewRef.current) setOverviewLoading(true);
      try {
        const payload = await getOverview(controller.signal);
        if (controller.signal.aborted) return;
        overviewRef.current = payload;
        setOverview(payload);
        setOverviewLoadedAt(Date.now());
        setOverviewError("");
      } catch (failure) {
        if (isAbortError(failure) || controller.signal.aborted) return;
        if (isUnauthorized(failure)) {
          handleUnauthorized();
          return;
        }
        setOverviewError(adminErrorMessage(failure, "نمای کلی دریافت نشد."));
      } finally {
        if (overviewRequest.current === controller) {
          overviewRequest.current = null;
          setOverviewLoading(false);
          setOverviewRefreshing(false);
        }
      }
    },
    [session, handleUnauthorized],
  );

  useEffect(() => {
    if (!session) {
      overviewRequest.current?.abort();
      setOverviewLoading(false);
      setOverviewRefreshing(false);
      return;
    }

    let stopped = false;
    let timer = 0;

    const schedule = (delay: number) => {
      if (stopped) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void run(), delay);
    };

    const run = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      await loadOverview(false);
      // Polling only this endpoint, every 10s, and only after the prior call settles.
      if (!stopped) schedule(10000);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        window.clearTimeout(timer);
        overviewRequest.current?.abort();
      } else {
        window.clearTimeout(timer);
        void run();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") void run();
    else setOverviewLoading(false);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      overviewRequest.current?.abort();
    };
  }, [session, loadOverview]);

  const { command: publishCommand, error: publishCommandError } = useCommandPoll({
    commandId: publishCommandId,
    onUnauthorized: handleUnauthorized,
    onSettled: (command) => {
      if (command.state === "applied") {
        notify("فرمان انتشار اعمال شد", "وضعیت انتشار از سرور دوباره خوانده می‌شود.", "success");
        void loadOverview(true);
      } else if (command.state === "failed") {
        notify("فرمان انتشار ناموفق بود", command.error || "جزئیات در وضعیت فرمان آمده است.", "error");
      }
    },
  });

  const doPublish = async () => {
    if (!session) return;
    setPublishBusy(true);
    setPublishError("");
    try {
      const result = await publish(session.csrf);
      if (!result.commandId) {
        setPublishError("سرور شناسهٔ فرمان انتشار را برنگرداند؛ انتشار را انجام‌شده ندانید.");
        return;
      }
      setPublishCommandId(result.commandId);
      setPublishOpen(false);
      notify(
        "فرمان انتشار در صف ثبت شد",
        "این به معنی انتشار نهایی نیست؛ وضعیت فرمان از سرور پیگیری می‌شود.",
        "info",
      );
    } catch (failure) {
      if (isUnauthorized(failure)) {
        handleUnauthorized();
        return;
      }
      setPublishError(adminErrorMessage(failure, "ثبت فرمان انتشار ناموفق بود."));
    } finally {
      setPublishBusy(false);
    }
  };

  const doLogout = async () => {
    if (!session) return;
    setLogoutBusy(true);
    setLogoutError("");
    try {
      await logout(session.csrf);
      window.location.assign("/login");
      setSession(null);
      setAuthState("signed-out");
      setSessionMessage("از پنل مدیریت خارج شدید.");
      overviewRef.current = null;
      setOverview(null);
      setOverviewLoadedAt(null);
      setPublishCommandId(null);
      setTab("overview");
    } catch (failure) {
      if (isUnauthorized(failure)) {
        handleUnauthorized();
        return;
      }
      setLogoutError(adminErrorMessage(failure, "خروج از نشست انجام نشد."));
    } finally {
      setLogoutBusy(false);
    }
  };

  const currentTab = TABS.find((entry) => entry.key === tab) ?? TABS[0];
  const publishPending =
    publishCommand?.state === "pending" || publishCommand?.state === "running";
  const publishQueued = Boolean(publishCommandId) && (!publishCommand || publishPending);
  const publishMeta = publishCommand ? commandStateMeta(publishCommand.state) : null;
  const overviewPending = overviewLoading || (!overview && !overviewError);

  if (authState === "loading") {
    return (
      <div className="av-admin av-root grid min-h-[70dvh] place-items-center px-4">
        <ConsoleSkin />
        <div className="text-center" role="status" aria-live="polite">
          <span className="mx-auto grid size-14 place-items-center rounded-3xl border border-violet-300/25 bg-violet-400/10 text-violet-200">
            <Loader2 className="size-6 animate-spin" />
          </span>
          <p className="mt-4 text-[13px] font-bold text-white">بررسی نشست مدیریت…</p>
          <p className="mt-1 text-[11px] text-content-muted">وضعیت ورود از سرور خوانده می‌شود.</p>
        </div>
      </div>
    );
  }

  if (authState === "signed-out" || !session) {
    return (
      <div className="av-admin av-root min-h-[100dvh] pb-16">
        <ConsoleSkin />
        <div className="mx-auto max-w-sm py-20 text-center"><p className="mb-4 text-sm text-content-muted">دسترسی به این صفحه در حال حاضر امکان‌پذیر نیست.</p><Link href="/login" className="btn btn-primary">ورود به حساب</Link></div>
        <NoticeViewport notice={notice} onDismiss={() => setNotice(null)} />
      </div>
    );
  }

  return (
    <div className="av-admin av-root min-h-[100dvh] pb-16" dir="rtl">
      <ConsoleSkin />
      <div className="mx-auto w-full max-w-[1440px] px-3 sm:px-5 lg:px-8">
        <header className="sticky top-[calc(var(--header-h)+6px)] z-40 mt-2">
          <div className="av-card flex flex-wrap items-center justify-between gap-2 rounded-3xl px-3 py-2.5 sm:px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-amber-400/25 bg-amber-400/10 text-amber-200">
                <ShieldCheck className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-black text-white">
                  مرکز مدیریت AnimeVerse
                  <RoleBadge role={session.user.role} />
                  {publishMeta ? <StatusChip tone={publishMeta.tone}>{publishMeta.label}</StatusChip> : null}
                </p>
                <p className="truncate text-[9.5px] text-content-faint" dir="ltr">
                  {session.user.email} · {session.user.name}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void loadOverview(true)}
                disabled={overviewRefreshing}
                className="btn btn-glass btn-sm"
                aria-label="به‌روزرسانی نمای کلی"
                title="به‌روزرسانی نمای کلی"
              >
                <RefreshCw className={cn("size-3.5", overviewRefreshing && "animate-spin")} />
                <span className="hidden sm:inline">{overviewRefreshing ? "در حال دریافت…" : "تازه‌سازی"}</span>
              </button>
              {permissions.canPublish ? (
                <button
                  type="button"
                  onClick={() => {
                    setPublishError("");
                    setPublishOpen(true);
                  }}
                  disabled={publishQueued || publishBusy}
                  className="btn btn-primary btn-sm"
                >
                  <Send className="size-3.5" />
                  {publishQueued ? "انتشار در جریان…" : "انتشار"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void doLogout()}
                disabled={logoutBusy}
                className="btn btn-glass btn-sm text-danger"
                aria-label="خروج از پنل"
                title="خروج از پنل"
              >
                {logoutBusy ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
                <span className="hidden sm:inline">خروج</span>
              </button>
            </div>
          </div>
          {logoutError ? <InlineError message={logoutError} className="mt-2" /> : null}
          {publishError ? <InlineError message={publishError} className="mt-2" /> : null}
          {publishCommand?.state === "failed" && publishCommand.error ? (
            <InlineError message={`فرمان انتشار: ${publishCommand.error}`} className="mt-2" />
          ) : null}
          {publishCommandError ? (
            <InlineError message={`وضعیت فرمان انتشار: ${publishCommandError}`} className="mt-2" />
          ) : null}
        </header>

        <div className="mt-3 grid gap-3 lg:grid-cols-[238px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="sticky top-[calc(var(--header-h)+84px)] space-y-3">
              <ConsoleCard className="p-3">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-10 place-items-center rounded-2xl border border-violet-300/25 bg-violet-400/10 text-violet-200">
                    <UserRound className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-bold text-white">{session.user.name}</p>
                    <p className="truncate text-[9.5px] text-content-faint" dir="ltr">
                      {session.user.email}
                    </p>
                  </div>
                </div>
                <details className="mt-3 text-[10px] leading-5 text-content-faint">
                  <summary className="cursor-pointer">جزئیات دسترسی</summary>
                <div className="mt-2 space-y-2">
                  <p className="flex items-center gap-1">
                    <Clock3 className="size-3" />
                    اعتبار نشست: {formatDateTime(session.expiresAt)}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {permissions.canEditCatalog ? <StatusChip tone="neutral">ویرایش انیمه‌ها</StatusChip> : null}
                    {permissions.canPublish ? <StatusChip tone="amber">انتشار</StatusChip> : null}
                    {permissions.canManageUsers ? <StatusChip tone="neutral">کاربران</StatusChip> : null}
                    {permissions.canManageSettings ? <StatusChip tone="neutral">تنظیمات</StatusChip> : null}
                  </div>
                </div>
                </details>
              </ConsoleCard>

              <nav aria-label="بخش‌های پنل مدیریت" className="av-card rounded-3xl p-2">
                <ul className="space-y-1">
                  {TABS.filter((entry) => !entry.ownerOnly || permissions.canManageUsers).map((entry) => {
                    const active = entry.key === tab;
                    return (
                      <li key={entry.key}>
                        <button
                          type="button"
                          onClick={() => setTab(entry.key)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-right transition-colors",
                            active
                              ? "border border-amber-400/30 bg-amber-400/[0.09] text-white"
                              : "border border-transparent text-content-muted hover:bg-white/[0.05] hover:text-white",
                          )}
                        >
                          <entry.icon className={cn("size-4", active ? "text-amber-300" : "text-violet-300/70")} />
                          <span className="flex-1 text-[11.5px] font-bold">{entry.label}</span>
                          {active ? <ChevronLeft className="size-3.5 text-amber-300" /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="av-rule my-2" />
                <Link
                  href="/"
                  className="flex items-center gap-2 rounded-2xl px-3 py-2 text-[10.5px] font-semibold text-content-faint transition-colors hover:bg-white/[0.05] hover:text-white"
                >
                  <ArrowLeft className="size-3.5" />
                  بازگشت به سایت
                </Link>
              </nav>

            </div>
          </aside>

          <div className="min-w-0">
            <nav
              aria-label="ناوبری بخش‌های مدیریت در موبایل"
              className="av-card mb-3 rounded-2xl p-1.5 lg:hidden"
            >
              <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4">
                {TABS.filter((entry) => !entry.ownerOnly || permissions.canManageUsers).map((entry) => {
                  const active = entry.key === tab;
                  return (
                    <li key={entry.key}>
                      <button
                        type="button"
                        onClick={() => setTab(entry.key)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[10.5px] font-bold transition-colors",
                          active
                            ? "border border-amber-400/30 bg-amber-400/10 text-amber-100"
                            : "border border-transparent text-content-muted hover:bg-white/[0.05] hover:text-white",
                        )}
                      >
                        <entry.icon className="size-3.5" />
                        {entry.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="eyebrow">پنل مدیریت</span>
                  <StatusChip tone="neutral">{currentTab.label}</StatusChip>
                </div>
                <h1 className="mt-1 text-xl font-black text-white sm:text-2xl">{currentTab.label}</h1>
                <p className="mt-1 max-w-2xl text-[11.5px] leading-6 text-content-muted">
                  {currentTab.description}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusChip tone="violet">
                  <UserRound className="size-2.5" />
                  {session.user.name}
                </StatusChip>
                <StatusChip tone="neutral">
                  <Clock3 className="size-2.5" />
                  {formatDateTime(session.expiresAt)}
                </StatusChip>
              </div>
            </div>

            <PermissionsProvider value={permissions}>
              <div className="av-enter">
                {tab === "overview" ? (
                  <OverviewPanel
                    overview={overview}
                    loading={overviewPending}
                    error={overviewError}
                    lastLoadedAt={overviewLoadedAt}
                    refreshing={overviewRefreshing}
                    onRefresh={() => void loadOverview(true)}
                    onOpenCatalog={() => setTab("catalog")}
                    onOpenReview={() => setTab("review")}
                    onOpenDownloads={() => setTab("downloads")}
                  />
                ) : null}
                {tab === "catalog" ? (
                  <CatalogPanel
                    session={session}
                    onUnauthorized={handleUnauthorized}
                    notify={notify}
                  />
                ) : null}
                {tab === "review" ? (
                  <ReviewPanel
                    session={session}
                    onUnauthorized={handleUnauthorized}
                    notify={notify}
                  />
                ) : null}
                {tab === "downloads" ? (
                  <DownloadsPanel
                    overview={overview}
                    error={overviewError}
                    loading={overviewPending}
                    refreshing={overviewRefreshing}
                    onRefresh={() => void loadOverview(true)}
                  />
                ) : null}
                {tab === "users" && permissions.canManageUsers ? (
                  <UsersPanel
                    session={session}
                    onUnauthorized={handleUnauthorized}
                    notify={notify}
                  />
                ) : null}
                {tab === "history" ? (
                  <HistoryPanel
                    session={session}
                    onUnauthorized={handleUnauthorized}
                    notify={notify}
                  />
                ) : null}
                {tab === "settings" && permissions.canManageSettings ? (
                  <SettingsPanel
                    session={session}
                    onUnauthorized={handleUnauthorized}
                    onSessionInvalidated={invalidateSession}
                    notify={notify}
                  />
                ) : null}
              </div>
            </PermissionsProvider>

            <p className="mt-5 text-center text-[9.5px] leading-5 text-content-faint">
              داده‌های این پنل از API مدیریت همان مبدأ خوانده می‌شوند. ویرایش کاتالوگ با انتشار عمومی یکی نیست و
              دسترسی نهایی سمت سرور بررسی می‌شود.
            </p>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={publishOpen}
        onClose={() => {
          if (!publishBusy) setPublishOpen(false);
        }}
        onConfirm={() => void doPublish()}
        title="ثبت فرمان انتشار"
        description="فرمان به صف انتشار می‌رود. تا زمانی که سرور وضعیت «اعمال شد» را برنگرداند، انتشار را انجام‌شده ندانید."
        confirmLabel="ثبت فرمان"
        busy={publishBusy}
        error={publishError}
      >
        <div className="av-sub rounded-2xl px-3 py-2.5 text-[11px] leading-6 text-content-muted">
          <p>
            تغییرات در انتظار:{" "}
            <strong className="text-white">
              {overview ? faNum(overview.publication.pendingChanges) : "نامشخص"}
            </strong>
          </p>
          <p className="mt-1 text-[10px]">
            وضعیت فعلی انتشار: {overview?.publication.state ?? "در دسترس نیست"}
          </p>
        </div>
      </ConfirmDialog>

      <NoticeViewport notice={notice} onDismiss={() => setNotice(null)} />
    </div>
  );
}

/* ── Login ─────────────────────────────────────────────────────────────── */

function LoginPanel({
  message,
  initialError,
  onAuthenticated,
  onRetrySession,
}: {
  message: string;
  initialError: string;
  onAuthenticated: (session: AdminSession) => void;
  onRetrySession: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [messageState, setMessageState] = useState(message);

  useEffect(() => {
    setError(initialError);
  }, [initialError]);
  useEffect(() => {
    setMessageState(message);
  }, [message]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!password) {
      setError("گذرواژه یا کلید مدیریت را وارد کنید.");
      return;
    }
    setBusy(true);
    try {
      const next = await login({
        password,
        email: email.trim() ? email.trim() : undefined,
      });
      setPassword("");
      onAuthenticated(next);
    } catch (failure) {
      if (isUnauthorized(failure)) {
        setError("ایمیل یا گذرواژهٔ مدیریت پذیرفته نشد.");
      } else {
        setError(adminErrorMessage(failure, "ورود به پنل مدیریت ناموفق بود."));
      }
    } finally {
      setBusy(false);
    }
  };

  const useTabKey = async () => {
    setError("");
    // Read only after the explicit click. Never render or log the value.
    const key = readLegacyAdminKey();
    if (!key) {
      setError("کلید مدیریتی در sessionStorage این تب پیدا نشد.");
      return;
    }
    setKeyBusy(true);
    try {
      const next = await login({ password: key });
      // Remove the old key only after the server accepted it.
      clearLegacyAdminKey();
      onAuthenticated(next);
    } catch (failure) {
      if (isUnauthorized(failure)) {
        setError("کلید موجود در این تب پذیرفته نشد. کلید حذف نشد.");
      } else {
        setError(adminErrorMessage(failure, "ورود با کلید موجود ناموفق بود."));
      }
    } finally {
      setKeyBusy(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-8 sm:px-6 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:py-14">
      <section className="av-login-hero relative overflow-hidden rounded-4xl p-6 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-28 size-72 rounded-full bg-[radial-gradient(closest-side,rgba(167,139,250,.25),transparent)]"
        />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[10px] font-bold text-amber-200">
            <ShieldCheck className="size-3" />
            ورود مستقل مدیریت
          </span>
          <h1 className="mt-4 text-2xl font-black leading-tight text-white sm:text-3xl">
            اتاق کنترل
            <span className="text-amber-300"> AnimeVerse</span>
          </h1>
          <p className="mt-2 max-w-md text-[12px] leading-7 text-content-muted">
            این ورود به حساب محلی مرورگر وابسته نیست. نشست مدیریت با کوکی HttpOnly سمت سرور نگه‌داری می‌شود و هر
            تغییر، شناسهٔ CSRF خودش را دارد.
          </p>
          <ul className="mt-6 space-y-2.5">
            {[
              { icon: LayoutDashboard, text: "نمای زندهٔ موجودی، کش، انتشار و فرمان‌ها" },
              { icon: LibraryBig, text: "ویرایش کاتالوگ و کیفیت‌های واقعی، بدون آمار ساختگی" },
              { icon: ClipboardCheck, text: "بازبینی آرشیو با پیش‌نمایش اجباری و نتیجهٔ نهایی سرور" },
              { icon: History, text: "تاریخچهٔ رویداد و بازگردانی قابل ردیابی" },
            ].map((item) => (
              <li key={item.text} className="flex items-start gap-2.5 text-[11.5px] leading-6 text-content-soft">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-xl border border-violet-300/20 bg-violet-400/10 text-violet-200">
                  <item.icon className="size-3.5" />
                </span>
                {item.text}
              </li>
            ))}
          </ul>
          <p className="mt-6 border-t border-white/[0.08] pt-3 text-[9.5px] leading-5 text-content-faint">
            کلید یا گذرواژه در localStorage ذخیره نمی‌شود و مقدار خام آن هرگز در رابط نمایش داده نمی‌شود.
          </p>
        </div>
      </section>

      <section className="av-card rounded-4xl p-5 sm:p-7">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-white">ورود به پنل</h2>
            <p className="mt-1 text-[11px] leading-5 text-content-muted">
              با حساب مدیریت سایت یا کلید قدیمی مالک.
            </p>
          </div>
          <span className="grid size-11 place-items-center rounded-2xl border border-violet-300/20 bg-violet-400/10 text-violet-200">
            <Lock className="size-5" />
          </span>
        </div>

        {messageState ? (
          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5 text-[10.5px] leading-5 text-amber-100">
            <Clock3 className="mt-0.5 size-3.5 shrink-0" />
            <span>{messageState}</span>
          </div>
        ) : null}

        <form onSubmit={submit} className="mt-4 space-y-3" noValidate>
          <label className="block">
            <span className="mb-1.5 block text-[10.5px] font-semibold text-content-soft">
              ایمیل مدیریت <span className="font-normal text-content-faint">(اختیاری)</span>
            </span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              dir="ltr"
              placeholder="admin@example.com"
              className="field h-11 text-[12px]"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center justify-between text-[10.5px] font-semibold text-content-soft">
              گذرواژه یا کلید مدیریت
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="text-[9.5px] font-normal text-content-faint underline underline-offset-4"
              >
                {showPassword ? "پنهان کردن" : "نمایش"}
              </button>
            </span>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              dir="ltr"
              className="field h-11 text-[12px]"
            />
          </label>

          {error ? <InlineError message={error} /> : null}

          <button type="submit" disabled={busy || keyBusy} className="btn btn-primary btn-md w-full">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            {busy ? "در حال ورود…" : "ورود امن"}
          </button>
        </form>

        <div className="my-4 flex items-center gap-2">
          <span className="h-px flex-1 bg-white/[0.08]" />
          <span className="text-[9px] text-content-faint">یا</span>
          <span className="h-px flex-1 bg-white/[0.08]" />
        </div>

        <button
          type="button"
          onClick={() => void useTabKey()}
          disabled={busy || keyBusy}
          className="btn btn-glass btn-md w-full"
        >
          {keyBusy ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
          {keyBusy ? "در حال بررسی کلید…" : "استفاده از کلید موجود در این تب"}
        </button>
        <p className="mt-2 text-center text-[9px] leading-4 text-content-faint">
          کلید فقط پس از کلیک از sessionStorage همین تب خوانده می‌شود و تنها بعد از پذیرش سرور حذف می‌گردد.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] pt-3">
          <Link href="/" className="btn btn-ghost btn-sm">
            <ArrowLeft className="size-3.5" />
            بازگشت به سایت
          </Link>
          <button type="button" onClick={onRetrySession} className="text-[10px] text-content-faint underline underline-offset-4 hover:text-white">
            بررسی دوبارهٔ نشست
          </button>
        </div>
        <p className="mt-3 flex items-center gap-1 text-[9px] text-content-faint">
          <Info className="size-3 shrink-0" />
          اگر دسترسی ندارید، از مالک سایت بخواهید نقش مدیریتی شما را بررسی کند.
        </p>
      </section>
    </div>
  );
}

/* ── Notice ────────────────────────────────────────────────────────────── */

function NoticeViewport({ notice, onDismiss }: { notice: NoticeItem | null; onDismiss: () => void }) {
  if (!notice) return null;
  const Icon = notice.tone === "error" ? AlertTriangle : notice.tone === "info" ? Info : CheckCircle2;
  return (
    <div
      className="fixed inset-x-0 bottom-4 z-[130] px-4 sm:bottom-6"
      role={notice.tone === "error" ? "alert" : "status"}
      aria-live={notice.tone === "error" ? "assertive" : "polite"}
    >
      <div
        className={cn(
          "av-admin mx-auto flex max-w-md items-start gap-2.5 rounded-2xl border px-3.5 py-3 shadow-lift backdrop-blur-xl",
          notice.tone === "error"
            ? "av-notice-error text-danger"
            : notice.tone === "info"
              ? "av-notice-info text-violet-100"
              : "av-notice-success text-success",
        )}
      >
        <Icon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-bold">{notice.title}</p>
          {notice.description ? (
            <p className="mt-0.5 text-[10px] leading-5 text-content-muted">{notice.description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="بستن اعلان"
          className="grid size-7 shrink-0 place-items-center rounded-full text-content-faint transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
