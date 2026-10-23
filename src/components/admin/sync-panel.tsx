"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Clock3,
  Loader2,
  Play,
  Radio,
  ShieldCheck,
  Square,
  Terminal,
  WifiOff,
} from "lucide-react";
import { cn, faDigits, faNum } from "@/lib/utils";

const KEY_STORAGE = "av_admin_key";

/** The admin key is never bundled: it is typed once and kept on this device only. */
function readAdminKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

type LogEntry = { ts: string; level: string; msg: string };

type SyncStatus = {
  state?: string;
  phase?: string;
  alive?: boolean;
  requestedPosts?: number;
  scannedPosts?: number;
  postsDone?: number;
  postsTotal?: number;
  animeNew?: number;
  animeUpdated?: number;
  catalogCount?: number;
  linksCount?: number;
  coversDone?: number;
  coversTotal?: number;
  linksTotal?: number;
  linksDone?: number;
  linksFailed?: number;
  linksPending?: number;
  current?: {
    key?: string;
    kind?: string;
    title?: string;
    postId?: number;
    postUrl?: string;
    slug?: string;
    episode?: number;
    quality?: string;
    attempt?: number;
  } | null;
  currentSince?: string | null;
  lastError?: string;
  error?: string;
  floodWaitUntil?: string | null;
  floodReason?: string;
  floodRequestedSec?: number;
  avgSecPerLink?: number;
  etaSec?: number | null;
  nextPollAt?: string | null;
  startedAt?: string;
  updatedAt?: string;
  heartbeatAt?: string;
  lastActivityAt?: string;
  serverNow?: number;
  linkDelay?: number;
  linkCooldown?: number;
  cooldownEvery?: number;
  watchInterval?: number;
  log?: LogEntry[];
};

const PHASES: Record<string, string> = {
  start: "شروع",
  ingest: "دریافت پست‌ها",
  covers: "ذخیرهٔ کاور‌ها",
  rebuild: "ساخت سایت",
  resolve: "آماده‌سازی لینک‌ها",
  watch: "دریافت خودکار",
  "watch-ingest": "بررسی پست جدید",
};

function fmtDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const value = Math.max(0, Math.round(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return `${faNum(hours)} ساعت و ${faNum(minutes)} دقیقه`;
  if (minutes > 0) return `${faNum(minutes)} دقیقه`;
  return "کمتر از یک دقیقه";
}

function fmtMinutes(seconds: number): string {
  return `${faNum(Math.max(1, Math.ceil(seconds / 60)))} دقیقه`;
}

function pct(done: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function ageSeconds(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const stamp = Date.parse(iso);
  if (Number.isNaN(stamp)) return 0;
  return Math.max(0, Math.floor((now - stamp) / 1000));
}

function remainingSeconds(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const stamp = Date.parse(iso);
  if (Number.isNaN(stamp)) return 0;
  return Math.max(0, Math.floor((stamp - now) / 1000));
}

export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [posts, setPosts] = useState(50);
  const [watch, setWatch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setAdminKey(readAdminKey());
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/sync", {
        headers: { "x-admin-key": adminKey },
        cache: "no-store",
      });
      if (response.status === 401 || response.status === 503) {
        setNeedsKey(true);
        setStatus(null);
        setPollError(false);
        return;
      }
      if (!response.ok) throw new Error("status");
      setNeedsKey(false);
      const payload = (await response.json()) as SyncStatus;
      setStatus(payload);
      setPollError(false);
      if (payload.state !== "running" && payload.state !== "watching") setStopping(false);
    } catch {
      setPollError(true);
    }
  }, [adminKey]);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => void load(), 2500);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [load]);

  const start = async () => {
    setError("");
    if (!Number.isFinite(posts) || posts < 1 || posts > 10000) {
      setError("تعداد پست باید بین ۱ تا ۱۰۰۰۰ باشد.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/admin/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ posts: Math.round(posts), watch }),
      });
      const payload = (await response.json()) as { error?: string };
      if (response.status === 401 || response.status === 503) {
        setNeedsKey(true);
        setError("کلید مدیریت لازم است.");
      } else if (!response.ok) {
        setError(payload.error ?? "شروع همگام‌سازی ناموفق بود.");
      } else {
        await load();
      }
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setError("");
    setStopping(true);
    try {
      const response = await fetch("/api/admin/sync/stop", {
        method: "POST",
        headers: { "x-admin-key": adminKey },
      });
      if (response.status === 401 || response.status === 503) {
        setNeedsKey(true);
        setError("کلید مدیریت لازم است.");
        setStopping(false);
      } else if (!response.ok) {
        setError("درخواست توقف ثبت نشد.");
        setStopping(false);
      }
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
      setStopping(false);
    }
  };

  const state = status?.state ?? "idle";
  const running = state === "running" || state === "watching";
  const phase = PHASES[status?.phase ?? ""] ?? status?.phase ?? "—";
  const postsTotal = status?.postsTotal ?? 0;
  const postsDone = status?.postsDone ?? 0;
  const linksTotal = status?.linksTotal ?? 0;
  const linksDone = status?.linksDone ?? 0;
  const linksFailed = status?.linksFailed ?? 0;
  const linksPct = pct(linksDone + linksFailed, linksTotal);
  const postsPct = pct(postsDone, postsTotal);
  const currentAge = ageSeconds(status?.currentSince, now);
  const activityAge = ageSeconds(status?.lastActivityAt, now);
  const heartbeatAge = ageSeconds(status?.heartbeatAt, now);
  const floodLeft = remainingSeconds(status?.floodWaitUntil, now);
  const stuck = running && Boolean(status?.current) && activityAge > 150 && floodLeft === 0;
  const nextPoll = remainingSeconds(status?.nextPollAt, now);
  const catalogCount = status?.catalogCount ?? 0;
  const linksCount = status?.linksCount ?? 0;
  const log = [...(status?.log ?? [])].slice(-40).reverse();

  const stateChip = (() => {
    if (pollError && !status) return { label: "اتصال قطع", className: "border-white/15 bg-white/[0.04] text-content-muted" };
    if (state === "running") return { label: "در حال اجرا", className: "border-amber-400/40 bg-amber-400/12 text-amber-200" };
    if (state === "watching") return { label: "دریافت خودکار", className: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200" };
    if (state === "done") return { label: "تمام شد", className: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200" };
    if (state === "stopped") return { label: "متوقف شد", className: "border-white/15 bg-white/[0.04] text-content-muted" };
    if (state === "error") return { label: "خطا", className: "border-rose-400/40 bg-rose-400/10 text-rose-200" };
    return { label: "آماده", className: "border-white/15 bg-white/[0.04] text-content-muted" };
  })();

  return (
    <section className="glass-card mt-4 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-amber-400/35 bg-amber-400/10 text-amber-300">
            <Radio className="size-4.5" />
          </span>
          <div>
            <h2 className="flex flex-wrap items-center gap-2 text-base font-black text-white">
              دریافت از تلگرام
              <span className={cn("rounded-full border px-2.5 py-0.5 text-[10px] font-bold", stateChip.className)}>
                {state === "running" ? <span className="me-1 inline-block size-1.5 animate-pulse rounded-full bg-amber-300" /> : null}
                {stateChip.label}
              </span>
            </h2>
            <p className="mt-1 max-w-2xl text-[11.5px] leading-6 text-content-muted">
              پست‌های <span dir="ltr">@aniplus</span> یکی‌یکی خوانده می‌شوند، کاور‌ها ذخیره می‌شوند و
              همهٔ کیفیت‌ها (۱۰۸۰p، ۷۲۰p، ۴۸۰p و x265) از ربات گرفته و در{" "}
              <span dir="ltr">@testanivers</span> فوروارد می‌شوند. ورکر روی سرور اجرا می‌شود؛ بستن مرورگر آن را قطع نمی‌کند.
            </p>
          </div>
        </div>
        <span className="rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1 text-[10.5px] font-semibold text-content-soft">
          {faDigits(catalogCount)} عنوان روی سایت · {faDigits(linksCount)} لینک آماده
        </span>
      </div>

      {needsKey ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = adminKey.trim();
            try {
              if (next) window.sessionStorage.setItem(KEY_STORAGE, next);
              else window.sessionStorage.removeItem(KEY_STORAGE);
            } catch {
              /* ignore */
            }
            setNeedsKey(false);
            void load();
          }}
          className="flex flex-wrap items-end gap-3 border-b border-white/[0.07] bg-amber-400/[0.04] px-5 py-4 sm:px-6"
        >
          <label className="min-w-[220px] flex-1">
            <span className="mb-1.5 block text-[11px] font-semibold text-content-muted">
              کلید مدیریت — فقط روی همین دستگاه ذخیره می‌شود و در سایت منتشر نمی‌شود
            </span>
            <input
              type="password"
              value={adminKey}
              onChange={(event) => setAdminKey(event.target.value)}
              dir="ltr"
              autoComplete="off"
              className="field h-11 w-full px-3 text-sm"
              placeholder="ADMIN_KEY"
            />
          </label>
          <button type="submit" className="btn btn-primary h-11 px-5 text-xs">
            <ShieldCheck className="size-4" />
            ذخیره و اتصال
          </button>
        </form>
      ) : null}

      <div className="p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-[170px_1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold text-content-muted">تعداد پست آخر (۱ تا ۱۰۰۰۰)</span>
            <input
              type="number"
              min={1}
              max={10000}
              value={posts}
              disabled={running || busy}
              onChange={(event) => setPosts(Number(event.target.value))}
              className="field h-11 w-full px-3 text-center text-sm tabular-nums disabled:opacity-50"
            />
          </label>
          <label className="flex h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-white/[0.09] bg-white/[0.03] px-3.5 text-[11.5px] font-semibold text-content-soft">
            <input
              type="checkbox"
              checked={watch}
              disabled={running || busy}
              onChange={(event) => setWatch(event.target.checked)}
              className="size-4 accent-amber-400"
            />
            بعد از این اجرا، پست‌های جدید را خودکار بگیر
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => void start()} disabled={running || busy} className="btn btn-primary h-11 px-5 text-xs">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              شروع دریافت
            </button>
            <button
              type="button"
              onClick={() => void stop()}
              disabled={!running || stopping}
              className="btn btn-glass h-11 px-4 text-xs"
            >
              {stopping ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-3.5" />}
              {stopping ? "در حال توقف" : "توقف"}
            </button>
          </div>
        </div>

        <p className="mt-2.5 text-[10.5px] leading-5 text-content-faint">
          برای ۵۰ پست، دریافت همهٔ کیفیت‌ها ممکن است چند ساعت طول بکشد. فاصلهٔ هر لینک{" "}
          {faDigits(status?.linkDelay ?? 60)} ثانیه است
          {status?.cooldownEvery
            ? ` و هر ${faDigits(status.cooldownEvery)} لینک، ${faDigits(status.linkCooldown ?? 300)} ثانیه استراحت`
            : ""}
          . اول آرشیو خصوصی جست‌وجو می‌شود و MiniBot فقط برای فایل‌های پیدا‌نشده است.
          در صورت محدودیت تلگرام، ورکر تا پایان همان مدت صبر می‌کند.
          {watch ? " بعد از پایان، هر ۵ دقیقه پست‌های جدید بررسی می‌شوند." : ""}
        </p>

        {pollError ? (
          <p className="mt-3 flex items-center gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] px-3.5 py-2.5 text-[11px] text-amber-200/90">
            <WifiOff className="size-3.5 shrink-0" />
            ارتباط با سرور موقتاً قطع است (مثلاً هنگام ساخت مجدد سایت)؛ دوباره تلاش می‌شود.
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 flex items-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-400/[0.07] px-3.5 py-2.5 text-[11px] text-rose-200">
            <AlertTriangle className="size-3.5 shrink-0" />
            {error}
          </p>
        ) : null}

        {running || state === "done" || state === "stopped" || state === "error" ? (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {[
                { label: "پست‌های این اجرا", value: postsTotal ? `${faDigits(postsDone)} / ${faDigits(postsTotal)}` : faDigits(postsDone) },
                { label: "لینک آماده", value: faDigits(linksDone) },
                { label: "ناموفق", value: faDigits(linksFailed) },
                {
                  label: running ? "زمان تقریبی" : "میانگین هر لینک",
                  value: running
                    ? fmtDuration(status?.etaSec)
                    : status?.avgSecPerLink
                      ? `${faDigits(status.avgSecPerLink)} ثانیه`
                      : "—",
                },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-center">
                  <p className="text-sm font-black tabular-nums text-white">{item.value}</p>
                  <p className="mt-0.5 text-[10px] text-content-faint">{item.label}</p>
                </div>
              ))}
            </div>

            {postsTotal > 0 ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-content-muted">
                  <span>دریافت پست‌ها · {phase}</span>
                  <span className="tabular-nums">{faDigits(postsPct)}٪</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                  <div className="h-full rounded-full bg-amber-400 transition-all duration-500" style={{ width: `${postsPct}%` }} />
                </div>
              </div>
            ) : null}

            {linksTotal > 0 ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-content-muted">
                  <span>
                    آماده‌سازی لینک‌ها · {faDigits(linksDone)} از {faDigits(linksTotal)}
                    {linksFailed ? ` · ${faDigits(linksFailed)} ناموفق` : ""}
                  </span>
                  <span className="tabular-nums">{faDigits(linksPct)}٪</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
                  <div className="h-full rounded-full bg-amber-400 transition-all duration-500" style={{ width: `${linksPct}%` }} />
                </div>
              </div>
            ) : null}

            {status?.current ? (
              <div className={cn(
                "rounded-2xl border px-4 py-3",
                stuck ? "border-rose-400/35 bg-rose-400/[0.07]" : "border-white/[0.08] bg-white/[0.03]",
              )}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-black/25 text-amber-300">
                      {status.current.kind === "post" ? <ArrowDownToLine className="size-3.5" /> : status.current.kind === "cover" ? <Activity className="size-3.5" /> : <Clock3 className="size-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-bold text-white">
                        {status.current.kind === "post" ? "پست " : status.current.kind === "cover" ? "کاور " : ""}
                        {status.current.title ?? "—"}
                        {status.current.kind === "link" ? (
                          <span className="font-medium text-content-muted">
                            {" "}— قسمت {faDigits(status.current.episode ?? 0)} · {status.current.quality}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-[10px] text-content-faint">
                        {status.current.postId ? (
                          <a
                            href={status.current.postUrl ?? `https://t.me/aniplus/${status.current.postId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-white/20 underline-offset-2 hover:text-white"
                          >
                            پست {faDigits(status.current.postId)}
                          </a>
                        ) : null}
                        {status.current.attempt ? ` · تلاش ${faDigits(status.current.attempt)}` : ""}
                        {" · "}
                        {faDigits(currentAge)} ثانیه از شروع
                        {activityAge > 20 && activityAge < currentAge - 10
                          ? ` · آخرین فعالیت ${faDigits(activityAge)} ثانیه پیش`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {stuck ? <span className="chip border-rose-400/40 bg-rose-400/10 text-rose-200">گیر کرده</span> : null}
                    {heartbeatAge > 20 && running ? (
                      <span className="chip border-rose-400/40 bg-rose-400/10 text-rose-200">ارتباط ورکر قطع</span>
                    ) : null}
                    {running && !stuck ? <Loader2 className="size-4 animate-spin text-amber-300" /> : null}
                  </div>
                </div>
              </div>
            ) : running ? (
              <p className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-[11px] text-content-muted">
                {state === "watching"
                  ? `در انتظار پست جدید — بررسی بعدی تا ${faDigits(nextPoll)} ثانیه دیگر`
                  : status?.phase === "resolve"
                    ? "بین دو لینک (استراحت کوتاه برای جلوگیری از محدودیت)"
                    : "در حال آماده‌سازی مرحلهٔ بعد…"}
              </p>
            ) : null}

            {floodLeft > 0 ? (
              <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.07] px-3.5 py-2.5 text-[11px] text-amber-200">
                <p className="flex items-center gap-2">
                  <Clock3 className="size-3.5 shrink-0" />
                  محدودیت تلگرام — {fmtMinutes(floodLeft)} صبر ({status?.floodReason || "FloodWait"})
                </p>
                <p className="mt-1.5 text-[9.5px] leading-5 text-amber-200/60">
                  این محدودیت از طرف تلگرام/MiniBot است، نه سایت. حالا فایل‌ها اول از آرشیو کپی می‌شوند و
                  MiniBot فقط برای موارد پیدا‌نشده استفاده می‌شود. اگر FloodWait رخ دهد، همان مدت اعلام‌شده
                  تلگرام صبر می‌کنیم و هیچ درخواست زودهنگامی نمی‌فرستیم.
                </p>
              </div>
            ) : null}

            {status?.lastError ? (
              <p className="rounded-2xl border border-rose-400/20 bg-rose-400/[0.05] px-3.5 py-2.5 text-[10.5px] leading-5 text-rose-200/85">
                <span className="font-bold">آخرین خطا: </span>
                <span className="break-words">{status.lastError}</span>
              </p>
            ) : null}

            <details className="group rounded-2xl border border-white/[0.07] bg-white/[0.02]">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-[11px] font-semibold text-content-soft">
                <span className="flex items-center gap-2">
                  <Terminal className="size-3.5 text-amber-300" />
                  لاگ زنده
                </span>
                <span className="text-[10px] text-content-faint">{faDigits(log.length)} مورد</span>
              </summary>
              <div className="max-h-56 overflow-y-auto border-t border-white/[0.06] px-3.5 py-2" dir="rtl">
                {log.length === 0 ? (
                  <p className="py-2 text-[10.5px] text-content-faint">هنوز رویدادی ثبت نشده.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {log.map((entry, index) => (
                      <li key={`${entry.ts}-${index}`} className="flex gap-2 text-[10.5px] leading-5">
                        <span className="shrink-0 tabular-nums text-content-faint" dir="ltr">{entry.ts}</span>
                        <span className={cn(
                          "break-words",
                          entry.level === "error" ? "text-rose-300" : entry.level === "warn" ? "text-amber-200/85" : "text-content-soft",
                        )}>
                          {entry.msg}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </div>
        ) : (
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.02] px-4 py-4 text-[11.5px] leading-6 text-content-muted">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-300" />
            <span>
              آمادهٔ شروع. با اولین اجرا، محتوای دمو با پست‌های واقعی جایگزین می‌شود و لینک‌ها به‌ترتیب آماده می‌شوند.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
