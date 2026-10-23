"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Eye,
  EyeOff,
  Heart,
  LayoutDashboard,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Undo2,
  UserRound,
  Users,
} from "lucide-react";
import { useApp } from "@/lib/app-context";
import { ANIME, SITE } from "@/lib/data";
import {
  clearAdmin,
  useAdminState,
  writeAdmin,
  type AdminState,
} from "@/lib/admin-store";
import { cn, faDigits, faNum } from "@/lib/utils";
import { Poster } from "@/components/ui/poster";
import { SyncPanel } from "@/components/admin/sync-panel";
import { Skeleton } from "@/components/ui/skeleton";

type Account = { name: string; email: string; joinedAt?: string };

function readAccounts(): Account[] {
  try {
    const raw = window.localStorage.getItem("av_accounts");
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as Account[]) : [];
  } catch {
    return [];
  }
}

export function AdminView() {
  const { ready, user, favorites, clearFavorites, toast } = useApp();
  const state = useAdminState();
  const [query, setQuery] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    setAccounts(readAccounts());
  }, [ready]);

  const visible = useMemo(
    () => ANIME.filter((a) => !state.hidden.includes(a.slug)),
    [state.hidden],
  );

  const episodeTotal = useMemo(
    () =>
      visible.reduce(
        (sum, a) => sum + (state.episodes[a.slug] ?? a.episodes),
        0,
      ),
    [visible, state.episodes],
  );

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...ANIME].sort(
      (a, b) => Number(state.pinned.includes(b.slug)) - Number(state.pinned.includes(a.slug)),
    );
    if (!q) return sorted;
    return sorted.filter((a) =>
      `${a.titleEn} ${a.title} ${a.slug}`.toLowerCase().includes(q),
    );
  }, [query, state.pinned]);

  const patch = (partial: Partial<AdminState>) => writeAdmin({ ...state, ...partial });

  const toggleIn = (key: "hidden" | "pinned", slug: string) => {
    const current = state[key];
    const next = current.includes(slug)
      ? current.filter((s) => s !== slug)
      : [slug, ...current];
    patch({ [key]: next } as Partial<AdminState>);
  };

  const resetAll = () => {
    clearAdmin();
    toast("تغییرات ادمین بازنشانی شد", "آرشیو به حالت اولیه برگشت.");
  };

  const dropAccount = (email: string) => {
    const next = readAccounts().filter((a) => a.email !== email);
    window.localStorage.setItem("av_accounts", JSON.stringify(next));
    setAccounts(next);
  };

  if (!ready) {
    return (
      <div className="shell py-10">
        <Skeleton className="h-10 w-56 rounded-full" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="mt-4 h-72 rounded-3xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="shell flex min-h-[70vh] items-center justify-center py-12">
        <div className="glass-card w-full max-w-md px-6 py-10 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-amber-400/35 bg-amber-400/12 text-amber-300">
            <ShieldCheck className="size-5" />
          </span>
          <h1 className="mt-4 text-xl font-black text-white">پنل ادمین</h1>
          <p className="mx-auto mt-2 max-w-xs text-[12.5px] leading-7 text-content-muted">
            برای دیدن پنل مدیریت اول وارد حساب شو.
          </p>
          <Link href="/login" className="btn btn-primary btn-lg mt-6 w-full">
            <UserRound className="size-4" />
            ورود به حساب
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="shell py-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="headline text-2xl sm:text-3xl">پنل ادمین</h1>
            <span className="chip border-amber-400/35 bg-amber-400/12 text-amber-200">مدیریت</span>
          </div>
          <p className="mt-2 text-[12.5px] leading-6 text-content-muted">
            همگام‌سازی واقعی تلگرام + ویرایش محلی عنوان‌ها، امتیاز‌ها و چیدمان.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={resetAll} className="btn btn-glass btn-sm">
            <RotateCcw className="size-3.5" />
            بازنشانی تغییرات
          </button>
          <Link href="/" className="btn btn-primary btn-sm">
            <LayoutDashboard className="size-3.5" />
            بازگشت به سایت
          </Link>
        </div>
      </div>

      <SyncPanel />

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Sparkles, label: "انیمهٔ فعال", value: faNum(visible.length) },
          { icon: LayoutDashboard, label: "قسمت‌ها", value: `${faNum(episodeTotal)}` },
          { icon: Users, label: "کاربران", value: faNum(accounts.length + 1) },
          { icon: Heart, label: "علاقه‌مندی‌ها", value: faNum(favorites.length) },
        ].map((stat) => (
          <div key={stat.label} className="glass-card px-4 py-4 text-center">
            <stat.icon className="mx-auto size-4 text-amber-300" />
            <p className="mt-2 text-xl font-black tabular-nums text-white">{stat.value}</p>
            <p className="mt-0.5 text-[11px] text-content-muted">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="glass-card mt-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-white">مدیریت انیمه‌ها</h2>
            <p className="mt-1 text-[11.5px] text-content-muted">
              ستاره = نمایش در هیرو، چشم = مخفی از آرشیو. عنوان، امتیاز و تعداد قسمت‌ها هم قابل ویرایش است.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute right-3.5 top-1/2 size-3.5 -translate-y-1/2 text-content-faint" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جست‌وجوی عنوان…"
              aria-label="جست‌وجو در فهرست انیمه‌ها"
              className="field h-10 ps-9 pe-4 text-[12px] [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
        </div>

        <div className="mt-4 hidden max-h-[560px] overflow-y-auto rounded-2xl border border-white/[0.07] md:block">
          <table className="w-full border-collapse text-right">
            <thead className="sticky top-0 z-10 bg-[#121218] text-[10.5px] text-content-faint">
              <tr>
                <th className="p-3 font-medium">عنوان</th>
                <th className="p-3 font-medium">امتیاز</th>
                <th className="p-3 font-medium">قسمت</th>
                <th className="p-3 font-medium">ویژه</th>
                <th className="p-3 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {list.map((anime) => {
                const pinned = state.pinned.includes(anime.slug);
                const hidden = state.hidden.includes(anime.slug);
                const score = state.scores[anime.slug] ?? anime.score;
                const episodes = state.episodes[anime.slug] ?? anime.episodes;
                return (
                  <tr key={anime.slug} className="border-t border-white/[0.06] text-[12px]">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <Poster
                          anime={anime}
                          sizes="40px"
                          thumb
                          position="50% 18%"
                          className="h-[52px] w-[37px] shrink-0 rounded-xl"
                        />
                        <span className="min-w-0">
                          <span className={cn("block truncate font-bold text-white", hidden && "text-content-faint line-through")}>
                            {state.titles[anime.slug] ?? anime.titleEn}
                          </span>
                          <span className="mt-0.5 block truncate text-[10.5px] text-content-faint">{anime.title}</span>
                        </span>
                      </div>
                    </td>
                    <td className="p-3">
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={0.1}
                        value={score}
                        onChange={(e) =>
                          patch({ scores: { ...state.scores, [anime.slug]: Number(e.target.value) } })
                        }
                        aria-label={`امتیاز ${anime.titleEn}`}
                        className="field h-9 w-20 px-2 text-center text-[12px] tabular-nums"
                      />
                    </td>
                    <td className="p-3">
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={episodes}
                        onChange={(e) =>
                          patch({ episodes: { ...state.episodes, [anime.slug]: Number(e.target.value) } })
                        }
                        aria-label={`تعداد قسمت ${anime.titleEn}`}
                        className="field h-9 w-20 px-2 text-center text-[12px] tabular-nums"
                      />
                    </td>
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => toggleIn("pinned", anime.slug)}
                        aria-pressed={pinned}
                        aria-label="نمایش در هیرو"
                        className={cn(
                          "grid size-9 place-items-center rounded-full border transition-colors",
                          pinned
                            ? "border-amber-400/50 bg-amber-400/15 text-amber-300"
                            : "border-white/[0.12] bg-white/[0.04] text-content-faint hover:text-white",
                        )}
                      >
                        <Star className={cn("size-3.5", pinned && "fill-amber-400")} />
                      </button>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleIn("hidden", anime.slug)}
                          aria-pressed={hidden}
                          aria-label={hidden ? "نمایش در آرشیو" : "مخفی کردن"}
                          className={cn(
                            "grid size-9 place-items-center rounded-full border transition-colors",
                            hidden
                              ? "border-danger/40 bg-danger/12 text-danger"
                              : "border-white/[0.12] bg-white/[0.04] text-content-faint hover:text-white",
                          )}
                        >
                          {hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        </button>
                        {(state.titles[anime.slug] !== undefined ||
                          state.scores[anime.slug] !== undefined ||
                          state.episodes[anime.slug] !== undefined ||
                          pinned ||
                          hidden) && (
                          <button
                            type="button"
                            onClick={() => {
                              const nextScores = { ...state.scores };
                              const nextEpisodes = { ...state.episodes };
                              const nextTitles = { ...state.titles };
                              delete nextScores[anime.slug];
                              delete nextEpisodes[anime.slug];
                              delete nextTitles[anime.slug];
                              patch({
                                scores: nextScores,
                                episodes: nextEpisodes,
                                titles: nextTitles,
                                pinned: state.pinned.filter((s) => s !== anime.slug),
                                hidden: state.hidden.filter((s) => s !== anime.slug),
                              });
                            }}
                            aria-label="بازنشانی این ردیف"
                            className="grid size-9 place-items-center rounded-full border border-white/[0.12] bg-white/[0.04] text-content-faint transition-colors hover:text-white"
                          >
                            <Undo2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 max-h-[560px] space-y-2 overflow-y-auto md:hidden">
          {list.map((anime) => {
            const pinned = state.pinned.includes(anime.slug);
            const hidden = state.hidden.includes(anime.slug);
            const score = state.scores[anime.slug] ?? anime.score;
            const episodes = state.episodes[anime.slug] ?? anime.episodes;
            return (
              <div
                key={anime.slug}
                className={cn(
                  "rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3",
                  hidden && "opacity-55",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Poster
                    anime={anime}
                    sizes="40px"
                    thumb
                    position="50% 18%"
                    className="h-[54px] w-[38px] shrink-0 rounded-xl"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-[12px] font-bold text-white", hidden && "line-through")}>
                      {state.titles[anime.slug] ?? anime.titleEn}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-content-faint">{anime.title}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleIn("pinned", anime.slug)}
                    aria-pressed={pinned}
                    aria-label="نمایش در هیرو"
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-full border transition-colors",
                      pinned
                        ? "border-amber-400/50 bg-amber-400/15 text-amber-300"
                        : "border-white/[0.12] bg-white/[0.04] text-content-faint",
                    )}
                  >
                    <Star className={cn("size-3.5", pinned && "fill-amber-400")} />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleIn("hidden", anime.slug)}
                    aria-pressed={hidden}
                    aria-label={hidden ? "نمایش در آرشیو" : "مخفی کردن"}
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-full border transition-colors",
                      hidden
                        ? "border-danger/40 bg-danger/12 text-danger"
                        : "border-white/[0.12] bg-white/[0.04] text-content-faint",
                    )}
                  >
                    {hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <label className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5">
                    <span className="text-[10px] text-content-faint">امتیاز</span>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step={0.1}
                      value={score}
                      onChange={(e) =>
                        patch({ scores: { ...state.scores, [anime.slug]: Number(e.target.value) } })
                      }
                      aria-label={`امتیاز ${anime.titleEn}`}
                      className="w-12 bg-transparent text-center text-[11px] tabular-nums text-white outline-none"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5">
                    <span className="text-[10px] text-content-faint">قسمت</span>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={episodes}
                      onChange={(e) =>
                        patch({ episodes: { ...state.episodes, [anime.slug]: Number(e.target.value) } })
                      }
                      aria-label={`تعداد قسمت ${anime.titleEn}`}
                      className="w-12 bg-transparent text-center text-[11px] tabular-nums text-white outline-none"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="glass-card p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-black text-white">کاربران</h2>
            <span className="chip">حساب‌های محلی</span>
          </div>

          <ul className="mt-4 space-y-2">
            {user ? (
              <li className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-bold text-white">{user.name}</span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-content-faint" dir="ltr">
                    {user.email}
                  </span>
                </span>
                <span className="chip">حساب فعلی</span>
              </li>
            ) : null}
            {accounts.map((account) => (
              <li
                key={account.email}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-bold text-white">{account.name}</span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-content-faint" dir="ltr">
                    {account.email}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => dropAccount(account.email)}
                  aria-label={`حذف ${account.name}`}
                  className="grid size-9 shrink-0 place-items-center rounded-full border border-white/[0.12] bg-white/[0.04] text-content-faint transition-colors hover:border-danger/40 hover:text-danger"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              </li>
            ))}
            {accounts.length === 0 ? (
              <li className="rounded-2xl border border-dashed border-white/[0.12] px-3.5 py-4 text-center text-[11.5px] text-content-faint">
                حساب دیگری ثبت نشده — فقط حساب فعلی.
              </li>
            ) : null}
          </ul>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                clearFavorites();
                toast("علاقه‌مندی‌ها پاک شد", "لیست در همین مرورگر خالی شد.");
              }}
              className="btn btn-ghost btn-sm text-content-muted hover:bg-danger/10 hover:text-danger"
            >
              <Heart className="size-3.5" />
              پاک کردن علاقه‌مندی‌ها
            </button>
          </div>
        </div>

        <div className="glass-card p-5 sm:p-6">
          <h2 className="text-base font-black text-white">وضعیت محلی</h2>
          <dl className="mt-4 space-y-2 text-[12px]">
            {[
              { label: "کانال تلگرام", value: SITE.telegramHandle },
              { label: "انیمه‌های مخفی", value: faNum(state.hidden.length) },
              { label: "انیمه‌های ویژه", value: faNum(state.pinned.length) },
              { label: "کل عنوان‌ها", value: faNum(ANIME.length) },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-3 border-b border-white/[0.06] py-2.5 last:border-0"
              >
                <dt className="text-content-faint">{row.label}</dt>
                <dd className="font-semibold text-content-soft" dir="auto">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-3 text-[11px] leading-6 text-content-faint">
            این پنل محلی است: تغییرات فقط روی همین دستگاه ذخیره می‌شوند و روی سرور اعمال نمی‌شوند.
            ردیف‌های تغییر‌یافته دکمهٔ بازنشانی دارند.
          </p>
        </div>
      </div>

      <p className="mt-6 text-center text-[10.5px] text-content-faint">
        {faDigits(visible.length)} عنوان فعال · {faDigits(episodeTotal)} قسمت · آرشیو زنده
      </p>
    </div>
  );
}
