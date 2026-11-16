"use client";

import type { AdminSession, AdminUser } from "@/lib/admin-contract";
import {
  adminErrorMessage,
  createUser,
  getUsers,
  isAbortError,
  isUnauthorized,
  patchUser,
  type AdminUserPage,
  type AdminUserPatch,
} from "@/lib/admin-client";
import { cn } from "@/lib/utils";
import {
  Ban,
  Check,
  CircleUserRound,
  Loader2,
  Mail,
  RefreshCw,
  SearchX,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BusyButton,
  ConfirmDialog,
  ConsoleCard,
  ConsoleDialog,
  EmptyState,
  InlineError,
  LoadingRows,
  Pager,
  RoleBadge,
  roleLabel,
  SearchField,
  SectionHeading,
  StatusChip,
  errorText,
  formatDateTime,
  formatNumber,
  useDebouncedValue,
  usePermissions,
  type ConsoleNotice,
} from "@/components/admin/console-ui";

const ASSIGNABLE_ROLES: { value: "user" | "editor" | "reviewer"; label: string }[] = [
  { value: "user", label: "کاربر" },
  { value: "editor", label: "ویرایشگر" },
  { value: "reviewer", label: "بازبین" },
];

type PendingPatch = {
  user: AdminUser;
  patch: AdminUserPatch;
  description: string;
};

export function UsersPanel({
  session,
  onUnauthorized,
  notify,
}: {
  session: AdminSession;
  onUnauthorized: () => void;
  notify: ConsoleNotice;
}) {
  const { canManageUsers } = usePermissions();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 320);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminUserPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<PendingPatch | null>(null);
  const [patchBusy, setPatchBusy] = useState(false);
  const [patchError, setPatchError] = useState("");
  const [staffOpen, setStaffOpen] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!canManageUsers) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const request = ++requestRef.current;
    setError("");
    if (data?.items.length) setRefreshing(true);
    else setLoading(true);
    getUsers({ query: debouncedQuery, page }, controller.signal)
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
        setError(adminErrorMessage(failure, "فهرست کاربران دریافت نشد."));
      })
      .finally(() => {
        if (request !== requestRef.current) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, page, reload, canManageUsers, onUnauthorized]);

  if (!canManageUsers) {
    return (
      <ConsoleCard className="p-6 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-danger/30 bg-danger/10 text-danger">
          <ShieldCheck className="size-5" />
        </span>
        <h2 className="mt-3 text-[15px] font-black text-white">دسترسی محدود</h2>
        <p className="mx-auto mt-1 max-w-sm text-[11.5px] leading-6 text-content-muted">
          مدیریت کاربران فقط برای نقش مالک مجاز است. سرور نیز مستقل از این رابط، نقش را بررسی می‌کند.
        </p>
      </ConsoleCard>
    );
  }

  const changeQuery = (value: string) => {
    setQuery(value);
    setPage(1);
  };

  const requestPatch = (user: AdminUser, patch: AdminUserPatch, description: string) => {
    setPatchError("");
    setPending({ user, patch, description });
  };

  const confirmPatch = async () => {
    if (!pending) return;
    setPatchBusy(true);
    setPatchError("");
    try {
      await patchUser(pending.user.id, pending.patch, session.csrf);
      notify("تغییر کاربر ذخیره شد", `${pending.user.name} به‌روزرسانی شد.`, "success");
      setPending(null);
      setReload((value) => value + 1);
    } catch (failure) {
      if (isUnauthorized(failure)) {
        onUnauthorized();
        return;
      }
      setPatchError(errorText(failure, "ذخیرهٔ تغییر کاربر ناموفق بود."));
    } finally {
      setPatchBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <ConsoleCard className="p-4 sm:p-5">
        <SectionHeading
          icon={<Users className="size-4" />}
          title="کاربران سرور"
          description="حساب‌های واقعی وب‌سایت؛ حساب‌های محلی مرورگر یا شمارش ساختگی در این فهرست نیست."
          action={
            <div className="flex items-center gap-2">
              <BusyButton
                type="button"
                busy={refreshing}
                onClick={() => setReload((value) => value + 1)}
                className="btn btn-glass btn-sm"
              >
                <RefreshCw className="size-3.5" />
                به‌روزرسانی
              </BusyButton>
              <button type="button" onClick={() => setStaffOpen(true)} className="btn btn-primary btn-sm">
                <UserPlus className="size-3.5" />
                حساب کارمند
              </button>
            </div>
          }
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <SearchField
            value={query}
            onChange={changeQuery}
            label="جست‌وجوی کاربر"
            placeholder="نام یا ایمیل…"
            busy={loading || query !== debouncedQuery}
          />
          <StatusChip tone="neutral" className="ms-auto">
            {formatNumber(data?.total ?? 0)} حساب
          </StatusChip>
        </div>
        {error ? <InlineError message={error} onRetry={() => setReload((value) => value + 1)} className="mt-3" /> : null}
      </ConsoleCard>

      <ConsoleCard className="overflow-hidden">
        <div aria-busy={loading || refreshing} className="p-2 sm:p-3">
          {loading ? (
            <LoadingRows rows={6} />
          ) : data?.items.length ? (
            <ul className="space-y-2">
              {data.items.map((user) => {
                const protectedAccount = user.role === "owner";
                const self = user.id === session.user.id;
                const locked = protectedAccount || self;
                return (
                  <li key={user.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-2.5">
                        <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-violet-300/20 bg-violet-400/10 text-violet-200">
                          <CircleUserRound className="size-5" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="truncate text-[12.5px] font-bold text-white">{user.name}</p>
                            <RoleBadge role={user.role} />
                            {self ? <StatusChip tone="amber">حساب فعلی</StatusChip> : null}
                            {user.disabled ? <StatusChip tone="danger">غیرفعال</StatusChip> : null}
                            {protectedAccount ? <StatusChip tone="violet">محافظت‌شده</StatusChip> : null}
                          </div>
                          <p className="mt-1 flex items-center gap-1 truncate text-[10.5px] text-content-faint" dir="ltr">
                            <Mail className="size-3" />
                            {user.email}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-content-faint">
                            <span>عضویت: {formatDateTime(user.createdAt)}</span>
                            <span>آخرین ورود: {formatDateTime(user.lastLoginAt)}</span>
                            <span className="tabular-nums">{formatNumber(user.favorites)} علاقه‌مندی</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {locked ? (
                          <span className="text-[10px] text-content-faint">
                            {protectedAccount ? "مالک قابل غیرفعال‌سازی نیست" : "برای حساب فعلی محدود شده"}
                          </span>
                        ) : (
                          <>
                            <label className="flex items-center gap-1.5">
                              <span className="sr-only">نقش {user.name}</span>
                              <select
                                value={ASSIGNABLE_ROLES.some((role) => role.value === user.role) ? user.role : "user"}
                                onChange={(event) => {
                                  const role = event.target.value as "user" | "editor" | "reviewer";
                                  if (role === user.role) return;
                                  requestPatch(
                                    user,
                                    { role },
                                    `نقش «${user.name}» از «${roleLabel(user.role)}» به «${roleLabel(role)}» تغییر کند؟`,
                                  );
                                }}
                                className="field h-9 w-28 px-2 text-[11px]"
                              >
                                {ASSIGNABLE_ROLES.map((role) => (
                                  <option key={role.value} value={role.value}>
                                    {role.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              onClick={() =>
                                requestPatch(
                                  user,
                                  { disabled: !user.disabled },
                                  `${user.disabled ? "فعال‌سازی" : "غیرفعال‌سازی"} حساب «${user.name}»؟`,
                                )
                              }
                              className={cn(
                                "btn btn-sm",
                                user.disabled
                                  ? "border border-success/25 bg-success/10 text-success"
                                  : "border border-danger/25 bg-danger/10 text-danger",
                              )}
                            >
                              {user.disabled ? <Check className="size-3.5" /> : <Ban className="size-3.5" />}
                              {user.disabled ? "فعال‌سازی" : "غیرفعال‌سازی"}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : error ? (
            <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-[11px] leading-6 text-content-faint">
              فهرست کاربران در دسترس نیست؛ خطای بالا را ببینید یا دوباره تلاش کنید.
            </p>
          ) : (
            <EmptyState
              title="کاربری پیدا نشد"
              description="با جست‌وجوی فعلی حسابی برنگشت. فهرست فقط از حساب‌های واقعی سرور ساخته می‌شود."
              action={
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setPage(1);
                  }}
                  className="btn btn-glass btn-sm"
                >
                  <SearchX className="size-3.5" />
                  پاک کردن جست‌وجو
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
              label="صفحهٔ کاربران"
            />
          </div>
        ) : null}
      </ConsoleCard>

      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => {
          if (!patchBusy) {
            setPending(null);
            setPatchError("");
          }
        }}
        onConfirm={() => void confirmPatch()}
        title="تأیید تغییر حساب"
        description={pending?.description}
        confirmLabel="ثبت تغییر"
        tone={pending?.patch.disabled === true ? "danger" : "primary"}
        busy={patchBusy}
        error={patchError}
      >
        {pending ? (
          <div className="av-sub rounded-2xl px-3 py-2.5 text-[11px] leading-6 text-content-muted">
            <p className="font-bold text-white">{pending.user.name}</p>
            <p className="mt-0.5" dir="ltr">
              {pending.user.email}
            </p>
            <p className="mt-1">
              نقش فعلی: {roleLabel(pending.user.role)} · وضعیت: {pending.user.disabled ? "غیرفعال" : "فعال"}
              {pending.patch.role ? ` · نقش جدید: ${roleLabel(pending.patch.role)}` : ""}
            </p>
          </div>
        ) : null}
      </ConfirmDialog>

      {staffOpen ? (
        <StaffDialog
          session={session}
          onUnauthorized={onUnauthorized}
          notify={notify}
          onClose={() => setStaffOpen(false)}
          onCreated={() => {
            setStaffOpen(false);
            setReload((value) => value + 1);
          }}
        />
      ) : null}
    </div>
  );
}

function StaffDialog({
  session,
  onUnauthorized,
  notify,
  onClose,
  onCreated,
}: {
  session: AdminSession;
  onUnauthorized: () => void;
  notify: ConsoleNotice;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<"editor" | "reviewer">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const submit = async () => {
    setError("");
    if (name.trim().length < 2) {
      setError("نام باید حداقل ۲ نویسه باشد.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("یک ایمیل معتبر وارد کنید.");
      return;
    }
    if (password.length < 6) {
      setError("گذرواژه باید حداقل ۶ نویسه باشد.");
      return;
    }
    if (password !== confirmPassword) {
      setError("تکرار گذرواژه یکسان نیست.");
      return;
    }
    setBusy(true);
    try {
      await createUser(
        { name: name.trim(), email: email.trim(), password, role },
        session.csrf,
      );
      setPassword("");
      setConfirmPassword("");
      notify(
        "حساب کارمند ساخته شد",
        "گذرواژه فقط به سرور ارسال شد و در این مرورگر ذخیره نمی‌شود.",
        "success",
      );
      onCreated();
    } catch (failure) {
      if (isUnauthorized(failure)) {
        onUnauthorized();
        return;
      }
      setError(errorText(failure, "ساخت حساب کارمند ناموفق بود."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConsoleDialog
      open
      onClose={onClose}
      title="ساخت حساب کارمند"
      description="نقش‌های ویرایشگر و بازبین. گذرواژه در حافظهٔ محلی یا localStorage نگه‌داری نمی‌شود."
      width="sm"
      closeDisabled={busy}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn btn-ghost btn-md">
            انصراف
          </button>
          <button type="button" onClick={() => void submit()} disabled={busy} className="btn btn-primary btn-md">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            {busy ? "در حال ساخت…" : "ساخت حساب"}
          </button>
        </div>
      }
    >
      <div className="space-y-3 pb-1">
        <label className="block">
          <span className="mb-1.5 block text-[10.5px] font-semibold text-content-soft">نام نمایشی</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            className="field h-10 text-[12px]"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10.5px] font-semibold text-content-soft">ایمیل</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            dir="ltr"
            className="field h-10 text-[12px]"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 flex items-center justify-between text-[10.5px] font-semibold text-content-soft">
            گذرواژه
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
            autoComplete="new-password"
            dir="ltr"
            className="field h-10 text-[12px]"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10.5px] font-semibold text-content-soft">تکرار گذرواژه</span>
          <input
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            dir="ltr"
            className="field h-10 text-[12px]"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10.5px] font-semibold text-content-soft">نقش</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as "editor" | "reviewer")}
            className="field h-10 text-[12px]"
          >
            <option value="editor">ویرایشگر</option>
            <option value="reviewer">بازبین</option>
          </select>
        </label>
        <p className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[10px] leading-5 text-content-faint">
          ویرایشگر: کاتالوگ، بازبینی و انتشار. بازبین: مشاهده و بازبینی. دسترسی نهایی را سرور تعیین می‌کند.
        </p>
        {error ? <InlineError message={error} /> : null}
      </div>
    </ConsoleDialog>
  );
}
