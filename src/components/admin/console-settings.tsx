"use client";

import type { AdminSession, AdminSettings } from "@/lib/admin-contract";
import {
  adminErrorMessage,
  changePassword,
  getBackups,
  getSettings,
  isAbortError,
  isUnauthorized,
  patchSettings,
  type AdminBackup,
} from "@/lib/admin-client";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Archive,
  Check,
  Database,
  HardDrive,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  BusyButton,
  ConfirmDialog,
  ConsoleCard,
  InlineError,
  SectionHeading,
  StatusChip,
  errorText,
  formatBytes,
  formatDateTime,
  formatNumber,
  usePermissions,
  type ConsoleNotice,
} from "@/components/admin/console-ui";
import { Skeleton } from "@/components/ui/skeleton";
import { PostImportsPanel } from "@/components/admin/console-imports";

export function SettingsPanel({
  session,
  onUnauthorized,
  onSessionInvalidated,
  notify,
}: {
  session: AdminSession;
  onUnauthorized: () => void;
  onSessionInvalidated: (reason: string) => void;
  notify: ConsoleNotice;
}) {
  const { canManageSettings } = usePermissions();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [mode, setMode] = useState<"manual" | "automatic">("manual");
  const [confirmMode, setConfirmMode] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState("");
  const [backups, setBackups] = useState<AdminBackup[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(true);
  const [backupsError, setBackupsError] = useState("");
  const [backupReload, setBackupReload] = useState(0);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);

  useEffect(() => {
    if (!canManageSettings) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getSettings(controller.signal)
      .then((payload) => {
        setSettings(payload);
        setMode(payload.publicationMode);
      })
      .catch((failure) => {
        if (isAbortError(failure)) return;
        if (isUnauthorized(failure)) {
          onUnauthorized();
          return;
        }
        setError(adminErrorMessage(failure, "تنظیمات دریافت نشد."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload, canManageSettings, onUnauthorized]);

  useEffect(() => {
    if (!canManageSettings) {
      setBackupsLoading(false);
      return;
    }
    const controller = new AbortController();
    setBackupsLoading(true);
    setBackupsError("");
    getBackups(controller.signal)
      .then((payload) => setBackups(Array.isArray(payload.items) ? payload.items : []))
      .catch((failure) => {
        if (isAbortError(failure)) return;
        if (isUnauthorized(failure)) {
          onUnauthorized();
          return;
        }
        setBackupsError(adminErrorMessage(failure, "فهرست پشتیبان‌ها دریافت نشد."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBackupsLoading(false);
      });
    return () => controller.abort();
  }, [backupReload, canManageSettings, onUnauthorized]);

  if (!canManageSettings) {
    return (
      <ConsoleCard className="p-6 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-danger/30 bg-danger/10 text-danger">
          <ShieldCheck className="size-5" />
        </span>
        <h2 className="mt-3 text-[15px] font-black text-white">دسترسی محدود</h2>
        <p className="mx-auto mt-1 max-w-sm text-[11.5px] leading-6 text-content-muted">
          تنظیمات انتشار، بودجه‌ها و تغییر گذرواژه فقط برای نقش مالک در دسترس است. سرور نیز مستقل از این رابط
          دسترسی را بررسی می‌کند.
        </p>
      </ConsoleCard>
    );
  }

  const dirty = Boolean(settings && mode !== settings.publicationMode);

  const saveMode = async () => {
    if (!settings) return;
    setModeBusy(true);
    setModeError("");
    try {
      const result = await patchSettings(
        { expectedRevision: settings.revision, publicationMode: mode },
        session.csrf,
      );
      setSettings((current) =>
        current
          ? {
              ...current,
              publicationMode: mode,
              revision: result.revision ?? current.revision,
            }
          : current,
      );
      setConfirmMode(false);
      notify(
        "حالت انتشار ذخیره شد",
        "این تنظیم در سرور ثبت شد. انتشار واقعی کاتالوگ یک عملیات جداگانه است.",
        "success",
      );
    } catch (failure) {
      if (isUnauthorized(failure)) {
        onUnauthorized();
        return;
      }
      setModeError(errorText(failure, "ذخیرهٔ حالت انتشار ناموفق بود."));
      if (failure instanceof Error && "status" in failure && (failure as { status?: number }).status === 409) {
        setReload((value) => value + 1);
      }
    } finally {
      setModeBusy(false);
    }
  };

  const submitPassword = async () => {
    setPasswordError("");
    if (!oldPassword) {
      setPasswordError("گذرواژهٔ فعلی را وارد کنید.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("گذرواژهٔ جدید باید حداقل ۶ نویسه باشد.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("تکرار گذرواژهٔ جدید یکسان نیست.");
      return;
    }
    if (newPassword === oldPassword) {
      setPasswordError("گذرواژهٔ جدید باید با گذرواژهٔ فعلی متفاوت باشد.");
      return;
    }
    setPasswordBusy(true);
    try {
      await changePassword({ oldPassword, newPassword }, session.csrf);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notify(
        "گذرواژه تغییر کرد",
        "همهٔ نشست‌های مدیریت باطل شده‌اند؛ ورود دوباره لازم است.",
        "success",
      );
      onSessionInvalidated("گذرواژه تغییر کرد و نشست‌ها باطل شدند. دوباره وارد شوید.");
    } catch (failure) {
      if (isUnauthorized(failure)) {
        onUnauthorized();
        return;
      }
      setPasswordError(errorText(failure, "تغییر گذرواژه ناموفق بود."));
    } finally {
      setPasswordBusy(false);
    }
  };

  if (loading && !settings) {
    return (
      <div className="space-y-3" role="status" aria-label="در حال دریافت تنظیمات">
        <Skeleton className="h-40 rounded-3xl" />
        <Skeleton className="h-36 rounded-3xl" />
        <Skeleton className="h-52 rounded-3xl" />
      </div>
    );
  }

  if (!settings) {
    return (
      <ConsoleCard className="p-4 sm:p-5">
        <InlineError message={error || "تنظیمات در دسترس نیست."} onRetry={() => setReload((value) => value + 1)} />
      </ConsoleCard>
    );
  }

  return (
    <div className="space-y-3">
      <PostImportsPanel session={session} onUnauthorized={onUnauthorized} notify={notify} />
      <ConsoleCard className="p-4 sm:p-5">
        <SectionHeading
          icon={<Workflow className="size-4" />}
          title="حالت انتشار"
          description="انتخاب این‌که تغییرات کاتالوگ چگونه به سایت عمومی برسند. ذخیرهٔ حالت با انتشار فوری یکی نیست."
          action={
            <StatusChip tone={settings.publicationMode === "automatic" ? "violet" : "neutral"}>
              {settings.publicationMode === "automatic" ? "خودکار" : "دستی"}
            </StatusChip>
          }
        />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {(
            [
              {
                value: "manual" as const,
                title: "دستی",
                description: "انتشار عمومی فقط با فرمان صریح «انتشار» انجام می‌شود.",
              },
              {
                value: "automatic" as const,
                title: "خودکار",
                description: "سرور پس از تغییرات معتبر، انتشار را خودکار انجام می‌دهد.",
              },
            ]
          ).map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer gap-2.5 rounded-2xl border px-3 py-3 transition-colors",
                mode === option.value
                  ? "border-amber-400/35 bg-amber-400/[0.07]"
                  : "border-white/[0.08] bg-white/[0.025] hover:border-violet-300/25",
              )}
            >
              <input
                type="radio"
                name="publication-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => {
                  setMode(option.value);
                  setModeError("");
                }}
                className="mt-1 size-4 shrink-0 accent-amber-400"
              />
              <span>
                <span className="block text-[12px] font-bold text-white">{option.title}</span>
                <span className="mt-0.5 block text-[10.5px] leading-5 text-content-muted">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>
        {modeError ? <InlineError message={modeError} className="mt-2" /> : null}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] text-content-faint">
            نسخهٔ تنظیمات: {formatNumber(settings.revision)} · مدیر:{" "}
            <span dir="ltr">{settings.adminEmail}</span>
          </p>
          <BusyButton
            type="button"
            busy={modeBusy}
            disabled={!dirty}
            onClick={() => setConfirmMode(true)}
            className="btn btn-primary btn-sm"
          >
            <Save className="size-3.5" />
            {dirty ? "ذخیرهٔ حالت انتشار" : "بدون تغییر"}
          </BusyButton>
        </div>
      </ConsoleCard>

      <ConsoleCard className="p-4 sm:p-5">
        <SectionHeading
          icon={<Database className="size-4" />}
          title="بودجه‌های ثابت سرور"
          description="این محدودیت‌ها فقط خواندنی‌اند؛ ماشین حساب سرویس دلخواه یا فرمان شل در این رابط وجود ندارد."
          action={<StatusChip tone="neutral">فقط خواندنی</StatusChip>}
        />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <LimitCard label="کارگر مجاز" value={formatNumber(settings.limits.workerCount)} />
          <LimitCard label="کار فعال" value={formatNumber(settings.limits.activeJobs)} />
          <LimitCard label="فضای موقت" value={formatBytes(settings.limits.tempBytes)} />
          <LimitCard label="فضای داغ" value={formatBytes(settings.limits.hotBytes)} />
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-5 text-content-faint">
          <Lock className="mt-0.5 size-3 shrink-0" />
          یک کارگر و بودجهٔ ذخیره‌سازی از سوی سرور تعیین می‌شوند؛ این مقادیر توسط رابط کاربری قابل تغییر نیستند.
        </p>
      </ConsoleCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <ConsoleCard className="p-4 sm:p-5">
          <SectionHeading
            icon={<KeyRound className="size-4" />}
            title="تغییر گذرواژهٔ مدیر"
            description="پس از تغییر، همهٔ نشست‌های فعال باطل می‌شوند و باید دوباره وارد شوید."
          />
          <div className="mt-3 space-y-2.5">
            <PasswordField
              label="گذرواژهٔ فعلی"
              value={oldPassword}
              onChange={setOldPassword}
              visible={showPasswords}
              autoComplete="current-password"
            />
            <PasswordField
              label="گذرواژهٔ جدید"
              value={newPassword}
              onChange={setNewPassword}
              visible={showPasswords}
              autoComplete="new-password"
            />
            <PasswordField
              label="تکرار گذرواژهٔ جدید"
              value={confirmPassword}
              onChange={setConfirmPassword}
              visible={showPasswords}
              autoComplete="new-password"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowPasswords((value) => !value)}
                className="text-[10px] text-content-faint underline underline-offset-4 hover:text-white"
              >
                {showPasswords ? "پنهان کردن گذرواژه‌ها" : "نمایش گذرواژه‌ها"}
              </button>
              <button
                type="button"
                onClick={() => void submitPassword()}
                disabled={passwordBusy}
                className="btn btn-glass btn-sm"
              >
                {passwordBusy ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
                {passwordBusy ? "در حال تغییر…" : "تغییر گذرواژه"}
              </button>
            </div>
            {passwordError ? <InlineError message={passwordError} /> : null}
            <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-2.5 py-2 text-[10px] leading-5 text-amber-100">
              گذرواژه‌ها فقط در حافظهٔ همین فرم هستند و در localStorage یا نشست مرورگر ذخیره نمی‌شوند.
            </p>
          </div>
        </ConsoleCard>

        <ConsoleCard className="p-4 sm:p-5">
          <SectionHeading
            icon={<Archive className="size-4" />}
            title="پشتیبان‌های سرور"
            description="فهرست فقط خواندنی. بازیابی از مسیر بازگردانی رویداد در تاریخچه انجام می‌شود، نه دکمهٔ بازیابی انبوه."
            action={
              <button
                type="button"
                onClick={() => setBackupReload((value) => value + 1)}
                disabled={backupsLoading}
                className="btn btn-glass btn-sm"
              >
                <RefreshCw className={cn("size-3.5", backupsLoading && "animate-spin")} />
                تازه‌سازی
              </button>
            }
          />
          {backupsError ? <InlineError message={backupsError} className="mt-3" /> : null}
          <div className="mt-3">
            {backupsLoading && !backups.length ? (
              <div className="space-y-1.5">
                <div className="skeleton h-12 rounded-xl" />
                <div className="skeleton h-12 rounded-xl" />
              </div>
            ) : backups.length ? (
              <ul className="space-y-1.5">
                {backups.map((backup) => (
                  <li
                    key={backup.id}
                    className="av-sub flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[10.5px] text-content-soft" dir="ltr">
                        {backup.id}
                      </p>
                      <p className="mt-0.5 text-[9.5px] text-content-faint">
                        {backup.kind} · {formatDateTime(backup.createdAt)}
                      </p>
                    </div>
                    <StatusChip tone="neutral">
                      <HardDrive className="size-2.5" />
                      {formatBytes(backup.size)}
                    </StatusChip>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed border-white/10 px-3 py-6 text-center text-[10.5px] leading-5 text-content-faint">
                پشتیبانی از سرور برنگشته است.
              </p>
            )}
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-5 text-content-faint">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            برای بازگردانی تغییرات، از تاریخچه و رویداد قابل بازگردانی استفاده کنید.
          </p>
        </ConsoleCard>
      </div>

      <ConfirmDialog
        open={confirmMode}
        onClose={() => {
          if (!modeBusy) setConfirmMode(false);
        }}
        onConfirm={() => void saveMode()}
        title="تغییر حالت انتشار"
        description={
          mode === "automatic"
            ? "حالت خودکار می‌شود؛ سرور می‌تواند پس از تغییرات معتبر خودش منتشر کند."
            : "حالت دستی می‌شود؛ انتشار عمومی فقط با فرمان صریح انجام می‌شود."
        }
        confirmLabel="ذخیرهٔ تغییر"
        busy={modeBusy}
        error={modeError}
      >
        <div className="av-sub flex items-center gap-2 rounded-2xl px-3 py-2.5 text-[11px]">
          <Check className="size-4 text-success" />
          <span>
            حالت فعلی: <strong className="text-white">{settings.publicationMode === "automatic" ? "خودکار" : "دستی"}</strong>
            {" → "}
            حالت جدید: <strong className="text-white">{mode === "automatic" ? "خودکار" : "دستی"}</strong>
          </span>
        </div>
      </ConfirmDialog>
    </div>
  );
}

function LimitCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="av-sub rounded-2xl px-3 py-3">
      <p className="text-[10px] text-content-faint">{label}</p>
      <p className="mt-1 text-[13px] font-black tabular-nums text-white">{value}</p>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10.5px] font-semibold text-content-soft">{label}</span>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        dir="ltr"
        className="field h-10 text-[12px]"
      />
    </label>
  );
}
