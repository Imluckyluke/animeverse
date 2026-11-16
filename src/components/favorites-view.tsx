"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowLeft, Library, Sparkles } from "lucide-react";
import { useApp } from "@/lib/app-context";
import type { LibraryStatus } from "@/lib/library";
import { useCatalog } from "@/lib/admin-store";
import { FavoritesFolder, type FolderAnime } from "@/components/favorites-folder";
import { LibraryStoragePreview } from "@/components/loading-previews";

type GroupId = "favorites" | "watched" | LibraryStatus;

const GROUPS: { id: GroupId; label: string }[] = [
  { id: "favorites", label: "علاقه‌مندی‌ها" },
  { id: "watching", label: "در حال دنبال کردن" },
  { id: "planned", label: "برای بعد" },
  { id: "watched", label: "دیده‌شده‌ها" },
  { id: "completed", label: "تمام‌شده‌ها" },
  { id: "paused", label: "متوقف‌شده‌ها" },
];

export function FavoritesView({ items: catalogue }: { items: FolderAnime[] }) {
  const { ready, user, favorites, watched, library, setLibraryStatus } = useApp();
  const catalog = useCatalog(catalogue);

  const catalogBySlug = useMemo(() => new Map(catalog.map((anime) => [anime.slug, anime])), [catalog]);
  const groups = useMemo(() => {
    const result: Record<GroupId, FolderAnime[]> = { favorites: [], watching: [], planned: [], watched: [], completed: [], paused: [] };
    for (const slug of favorites) {
      const anime = catalogBySlug.get(slug);
      if (anime) result.favorites.push(anime);
    }
    for (const [slug, episodes] of Object.entries(watched)) {
      const anime = catalogBySlug.get(slug);
      if (anime && episodes.length > 0) result.watched.push(anime);
    }
    for (const [slug, status] of Object.entries(library)) {
      const anime = catalogBySlug.get(slug);
      if (anime && result[status]) result[status].push(anime);
    }
    return result;
  }, [catalogBySlug, favorites, watched, library]);
  const visibleGroups = GROUPS.filter(({ id }) => groups[id].length > 0);
  const isEmpty = visibleGroups.length === 0;
  if (ready && !user) return <section className="shell py-12"><div className="glass-card mx-auto max-w-lg p-6 text-center"><h1 className="headline text-xl">برای دیدن کتابخانه وارد شو</h1><p className="mt-3 text-sm leading-7 text-content-muted">اطلاعات ذخیره‌شده حذف نشده؛ کتابخانهٔ شخصی فقط پس از ورود نمایش داده می‌شود.</p><Link href="/login" className="btn btn-primary btn-md mt-5">ورود به حساب</Link></div></section>;

  return (
    <div className="shell min-h-[calc(100svh-var(--header-h))] py-8 sm:py-10 lg:py-12">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold text-amber-300"><Library aria-hidden className="size-4" /> فضای شخصی تماشای تو</div>
          <h1 className="headline text-[clamp(1.7rem,4vw,2.4rem)]">کتابخانهٔ من</h1>
          <p className="mt-3 max-w-xl text-sm leading-7 text-content-muted">لیست‌ها و سابقهٔ تماشای تو.</p>
        </div>
        <Link href="/browse" className="btn btn-ghost btn-md shrink-0">گشتن در آرشیو<ArrowLeft aria-hidden className="size-4" /></Link>
      </div>

      <div className="mt-6">
        {!ready ? (
          <LibraryStoragePreview />
        ) : (
          <>
            {isEmpty ? (
              <div className="empty-plate glass-card mx-auto flex max-w-xl flex-col items-center gap-4 px-5 py-10 text-center sm:py-14">
                <span className="grid size-14 place-items-center rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,.1)]"><Sparkles aria-hidden className="size-5 text-amber-200" /></span>
                <h2 className="text-base font-black text-white">کتابخانه‌ات آمادهٔ اولین انتخاب است</h2>
                <p className="text-[13px] leading-7 text-content-muted">با ذخیرهٔ اولین انیمه، پوشهٔ همان لیست اینجا ظاهر می‌شود.</p>
                <Link href="/browse" className="btn btn-glass btn-md mt-1">کشف انیمه<ArrowLeft aria-hidden className="size-4" /></Link>
              </div>
            ) : null}
            <div className={`grid grid-cols-1 items-start gap-5 ${visibleGroups.length === 1 ? "mx-auto max-w-[560px]" : "md:grid-cols-2 xl:grid-cols-3"}`}>
              {visibleGroups.map(({ id, label }) => (
                <section key={id} aria-label={label} className="glass-card min-w-0 px-3 pb-4 pt-2 sm:px-5">
                  <FavoritesFolder
                    items={groups[id]}
                    width={300}
                    label={label}
                    onRemove={id === "favorites" ? undefined : id === "watched" ? null : (slug) => setLibraryStatus(slug, null)}
                  />
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
