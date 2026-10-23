"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { useApp } from "@/lib/app-context";
import type { Anime } from "@/lib/catalog";
import { useCatalog } from "@/lib/admin-store";
import { FavoritesFolder } from "@/components/favorites-folder";
import { Skeleton } from "@/components/ui/skeleton";

export function FavoritesView({ items: catalogue }: { items: Anime[] }) {
  const { ready, favorites } = useApp();
  const catalog = useCatalog(catalogue);

  const items = useMemo(
    () =>
      favorites
        .map((slug) => catalog.find((a) => a.slug === slug))
        .filter((a): a is Anime => Boolean(a)),
    [favorites, catalog],
  );

  return (
    <div className="shell min-h-[calc(100svh-var(--header-h))] py-8 sm:py-10 lg:py-12">
      <h1 className="headline text-[clamp(1.7rem,4vw,2.4rem)]">علاقه‌مندی‌های من</h1>

      <div className="mt-6">
        {!ready ? (
          <div role="status" aria-label="بارگذاری علاقه‌مندی‌ها" className="flex justify-center py-5">
            <Skeleton className="h-[320px] w-[min(300px,80vw)] rounded-3xl" />
          </div>
        ) : (
          <div
            className={
              items.length
                ? "flex justify-center pb-4 pt-1 sm:pb-6"
                : "glass-card px-6 py-12 text-center sm:py-14"
            }
          >
            {/* Always the same element in the same slot, so emptying the list
                never remounts the folder and snaps it shut. */}
            <FavoritesFolder items={items} width={items.length ? 320 : 300} />

            {items.length === 0 ? (
              <>
                <p className="mx-auto mt-6 max-w-sm text-[12px] leading-6 text-content-muted">
                  روی قلب کنار هر انیمه بزن تا اینجا ذخیره شود؛ بعد داخل همین پوشه جمع می‌شوند.
                </p>
                <div className="mt-5 flex justify-center">
                  <Link href="/browse" className="btn btn-primary btn-md">
                    <Sparkles className="size-3.5" />
                    گشتن در آرشیو
                  </Link>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
