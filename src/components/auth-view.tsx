"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogOut,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useApp } from "@/lib/app-context";
import { canShowAdmin } from "@/lib/admin-visibility";
import { cn } from "@/lib/utils";
import { CoverImage } from "@/components/ui/cover-image";
import { InstallAppButton } from "@/components/install-app-button";
import { TelegramNotifyRow } from "@/components/telegram-notify-row";

type Mode = "login" | "register";

export function AuthView({
  initialMode = "login",
  cover,
  blur,
}: {
  initialMode?: Mode;
  /** Hero artwork resolved on the server so the catalogue never ships to the client. */
  cover?: string;
  blur?: string;
}) {
  const router = useRouter();
  const { ready, user, login, register, logout, canImportLocalPreferences, importLocalPreferences, pendingSyncCount, syncing, syncError } = useApp();
  const [importing, setImporting] = useState(false);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setErrors({});
    setFormError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError("");

    const nextErrors: Record<string, string> = {};
    if (mode === "register" && name.trim().length < 3) {
      nextErrors.name = "نام باید حداقل ۳ حرف باشد.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      nextErrors.email = "یک ایمیل معتبر وارد کن.";
    }
    if (password.length < 6 || password.length > 256) {
      nextErrors.password = "رمز عبور باید بین ۶ تا ۲۵۶ کاراکتر باشد.";
    }
    if (mode === "register" && !accepted) {
      nextErrors.accepted = "برای ادامه، قوانین را بپذیر.";
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    setLoading(true);
    try {
      const result =
        mode === "login"
          ? await login(email, password)
          : await register(name, email, password);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      router.push("/");
    } finally {
      setLoading(false);
    }
  };


  return (
    <section className="shell py-8 sm:py-12">
      <div className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-2 lg:gap-6">
        <div className="glass-card relative overflow-hidden p-5 sm:p-7">
          <div aria-hidden className="absolute -right-24 -top-28 size-64 rounded-full bg-[radial-gradient(closest-side,rgba(255,214,10,.14),transparent)]" />

          <div className="relative">
            <h1 className="headline text-xl sm:text-2xl">
              {user ? "حساب کاربری" : mode === "login" ? "خوش برگشتی" : "ساخت حساب"}
            </h1>
            <p className="mt-2 text-[12.5px] leading-6 text-content-muted">
              {user
                ? "اطلاعات حساب و فهرست‌های شخصی‌ات را مدیریت کن."
                : "برای دسترسی به کتابخانه و دانلودهای شخصی وارد شو."}
            </p>
          </div>

          {!ready ? (
            <div className="relative mt-6 space-y-4">
              <div className="skeleton h-12 w-full rounded-xl" />
              <div className="skeleton h-12 w-full rounded-xl" />
              <div className="skeleton h-12 w-full rounded-xl" />
            </div>
          ) : user ? (
            <div className="relative mt-6">
              <div className="flex items-center gap-4">
                <span className="grid size-14 place-items-center rounded-2xl border border-white/[0.12] bg-white/[0.06] text-amber-300">
                  <UserRound className="size-6" strokeWidth={1.9} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-base font-black text-white">{user.name}</p>
                  <p className="mt-1 truncate text-[11.5px] text-content-faint" dir="ltr">
                    {user.email}
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <TelegramNotifyRow variant="card" />
              </div>
              <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-xs leading-6" role="status">
                {syncError ? <p className="text-danger">ذخیرهٔ تغییرات انجام نشد؛ دوباره تلاش کن.</p> : syncing || pendingSyncCount ? <p>در حال ذخیرهٔ تغییرات…</p> : <p className="text-content-muted">خوش آمدی، {user.name}.</p>}
                {canImportLocalPreferences ? <button className="btn btn-glass btn-sm mt-2" disabled={importing} onClick={async () => {
                  setImporting(true);
                  try { const result = await importLocalPreferences(); if (!result.ok) setFormError(result.error); }
                  finally { setImporting(false); }
                }}>{importing ? "در حال بازیابی…" : "بازیابی فهرست قبلی"}</button> : null}
                {formError ? <p className="mt-2 text-danger">{formError}</p> : null}
              </div>

              <div className="mt-5 space-y-2">
                <Link href="/browse" className="btn btn-primary btn-md w-full">
                  ادامهٔ گشتن در آرشیو
                </Link>
                <InstallAppButton variant="card" />
                {canShowAdmin(user) ? <Link href="/admin" className="btn btn-glass btn-md w-full">
                  <ShieldCheck className="size-3.5" />
                  پنل ادمین
                </Link> : null}
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    router.push("/");
                  }}
                  className="btn btn-ghost btn-md w-full text-danger/80 hover:bg-danger/10 hover:text-danger"
                >
                  <LogOut className="size-3.5" />
                  خروج از حساب
                </button>
              </div>
            </div>
          ) : (
            <div className="relative mt-6">
              <div className="flex rounded-2xl border border-white/[0.1] bg-black/25 p-1">
                {(
                  [
                    { key: "login", label: "ورود" },
                    { key: "register", label: "ثبت‌نام" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => switchMode(tab.key)}
                    aria-pressed={mode === tab.key}
                    className={cn(
                      "relative flex-1 rounded-xl py-2.5 text-[12.5px] font-bold transition-colors",
                      mode === tab.key ? "text-white" : "text-content-muted hover:text-white",
                    )}
                  >
                    {mode === tab.key ? (
                      <motion.span
                        layoutId="auth-tab"
                        className="absolute inset-0 rounded-xl border border-white/[0.12] bg-white/[0.08] shadow-inset"
                        transition={{ type: "spring", stiffness: 400, damping: 34 }}
                      />
                    ) : null}
                    <span className="relative">{tab.label}</span>
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.form
                  key={mode}
                  onSubmit={submit}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.25 }}
                  className="mt-5 space-y-4"
                  noValidate
                >
                  {mode === "register" ? (
                    <AuthField
                      id="name"
                      label="نام نمایشی"
                      icon={<UserRound className="size-4" />}
                      placeholder="مثلاً: رضا"
                      value={name}
                      onChange={setName}
                      error={errors.name}
                      autoComplete="name"
                    />
                  ) : null}

                  <AuthField
                    id="email"
                    label="ایمیل"
                    icon={<Mail className="size-4" />}
                    placeholder="you@example.com"
                    value={email}
                    onChange={setEmail}
                    error={errors.email}
                    type="email"
                    dir="ltr"
                    autoComplete="email"
                  />

                  <AuthField
                    id="password"
                    label="رمز عبور"
                    icon={<Lock className="size-4" />}
                    placeholder={mode === "register" ? "حداقل ۶ کاراکتر" : "••••••••"}
                    value={password}
                    onChange={setPassword}
                    error={errors.password}
                    type={showPassword ? "text" : "password"}
                    dir="ltr"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "پنهان کردن رمز" : "نمایش رمز"}
                        className="grid size-10 place-items-center rounded-full text-content-faint transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/45"
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    }
                  />

                  {mode === "register" ? (
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                      <span
                        className={cn(
                          "mt-0.5 grid size-4 shrink-0 place-items-center rounded border transition-colors",
                          accepted
                            ? "border-amber-400 bg-amber-400 text-ink-950"
                            : "border-white/20 bg-white/[0.03]",
                        )}
                      >
                        {accepted ? <Check className="size-3" /> : null}
                      </span>
                      <input
                        type="checkbox"
                        checked={accepted}
                        onChange={(e) => setAccepted(e.target.checked)}
                        aria-describedby={errors.accepted ? "accepted-error" : undefined}
                        className="sr-only"
                      />
                      <span className="text-[10.5px] leading-5 text-content-muted">
                        <Link href="/terms" target="_blank" className="text-amber-300 underline underline-offset-4">قوانین استفاده</Link> و <Link href="/privacy" target="_blank" className="text-amber-300 underline underline-offset-4">حریم خصوصی</Link> انیمه‌ورس را می‌پذیرم.
                      </span>
                    </label>
                  ) : null}
                  {errors.accepted ? (
                    <p id="accepted-error" role="alert" className="-mt-2 text-[10px] font-semibold text-danger">
                      {errors.accepted}
                    </p>
                  ) : null}

                  {formError ? (
                    <p
                      role="alert"
                      className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2.5 text-[11px] font-semibold text-danger"
                    >
                      {formError}
                    </p>
                  ) : null}

                  <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full">
                    {loading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        {mode === "login" ? "در حال ورود…" : "در حال ساخت حساب…"}
                      </>
                    ) : mode === "login" ? (
                      <>
                        ورود به حساب
                        <ArrowLeft className="size-4" />
                      </>
                    ) : (
                      <>
                        ساخت حساب رایگان
                        <Sparkles className="size-4" />
                      </>
                    )}
                  </button>

                  {mode === "register" ? (
                    <Link href="/login" className="btn btn-glass btn-md w-full">
                      <UserRound className="size-3.5" />
                      حساب داری؟ وارد شو
                    </Link>
                  ) : null}

                  <p className="text-center text-xs leading-6 text-content-muted">
                    با ورود، فهرست‌های شخصی‌ات در دسترس‌اند.
                  </p>
                </motion.form>
              </AnimatePresence>
            </div>
          )}
        </div>

        <aside className="glass-card relative hidden overflow-hidden lg:block">
          {cover ? (
            <CoverImage src={cover} blur={blur} sizes="50vw" position="50% 18%" zoom={false} />
          ) : null}
          <div aria-hidden className="absolute inset-0 bg-ink-950/45" />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/55 to-transparent" />

          <div className="relative flex h-full min-h-[480px] flex-col justify-end p-7 xl:p-8">
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/45">
              ANIMEVERSE
            </span>
            <h2 className="text-shadow-hero mt-2 text-2xl font-black leading-[1.45] text-white xl:text-[26px]">
              هر انیمه، هر کیفیت، یک‌جا.
            </h2>
          </div>
        </aside>
      </div>
    </section>
  );
}

function AuthField({
  id,
  label,
  icon,
  placeholder,
  value,
  onChange,
  error,
  type = "text",
  dir,
  autoComplete,
  trailing,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
  dir?: "ltr" | "rtl";
  autoComplete?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-bold text-content-soft">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 right-3.5 grid place-items-center text-content-faint">
          {icon}
        </span>
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          dir={dir}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(
            "field pr-10",
            trailing && "pl-12",
            error && "border-danger/50 focus:border-danger/60",
          )}
        />
        {trailing ? (
          <span className="absolute inset-y-0 left-2 z-10 flex items-center">{trailing}</span>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[10px] font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
