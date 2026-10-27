import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const glass = "rounded-3xl border border-white/[0.1] bg-[rgba(16,16,23,.48)] shadow-[inset_0_1px_0_rgba(255,255,255,.05)] backdrop-blur-[6px]";

function LoadingRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div dir="rtl" role="status" aria-live="polite" aria-busy="true" aria-label={label} className="min-w-0 overflow-hidden">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

function HeadingPreview() {
  return <Skeleton className="h-8 w-48 max-w-full sm:h-9" />;
}

function PosterPreview() {
  return (
    <div className="min-w-0 space-y-2">
      <Skeleton className="aspect-[2/3] w-full rounded-2xl border border-white/[0.07]" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-2.5 w-1/2" />
    </div>
  );
}

function ChipsPreview() {
  return <div className="flex gap-2 overflow-hidden">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-9 w-20 shrink-0 rounded-full" />)}</div>;
}

/** Also used while the browser's personal library storage becomes ready. */
export function LibraryStoragePreview() {
  return (
    <LoadingRegion label="در حال خواندن کتابخانهٔ این دستگاه">
      <div className={`${glass} flex min-h-32 items-center gap-4 border-amber-400/[0.12] p-5 sm:p-6`}>
        <Skeleton className="size-10 shrink-0 rounded-2xl bg-amber-400/[0.08]" />
        <div className="min-w-0 flex-1 space-y-3">
          <Skeleton className="h-3 w-40 max-w-full" />
          <Skeleton className="h-2.5 w-64 max-w-[85%]" />
        </div>
      </div>
    </LoadingRegion>
  );
}

export function LibraryLoadingPreview() {
  return (
    <div dir="rtl" className="shell min-h-[calc(100svh-var(--header-h))] py-8 sm:py-10 lg:py-12">
      <div aria-hidden="true" className="mb-6 space-y-3">
        <Skeleton className="h-3 w-36 max-w-full" />
        <Skeleton className="h-10 w-56 max-w-full" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="h-4 w-3/4 max-w-md" />
      </div>
      <LibraryStoragePreview />
    </div>
  );
}

export function ArchiveLoadingPreview() {
  return (
    <LoadingRegion label="در حال بارگذاری آرشیو و جست‌وجوی انیمه">
      <div className="shell py-8 sm:py-10">
        <HeadingPreview />
        <div className="mt-6 space-y-4">
          <div className={`${glass} flex h-14 items-center gap-3 px-4`}>
            <Skeleton className="size-5 shrink-0 rounded-full" />
            <Skeleton className="h-3 w-52 max-w-[70%]" />
          </div>
          <ChipsPreview />
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-10 w-24 rounded-xl" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="ms-auto h-10 w-28 rounded-xl" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => <PosterPreview key={i} />)}
        </div>
      </div>
    </LoadingRegion>
  );
}

export function HomeLoadingPreview() {
  return (
    <LoadingRegion label="در حال بارگذاری صفحهٔ اصلی">
      <div className="relative isolate -mt-[var(--header-h)] overflow-hidden bg-gradient-to-bl from-amber-400/[0.06] via-white/[0.025] to-transparent">
        <div className="shell flex min-h-[min(680px,76svh)] items-end pb-6 pt-[calc(var(--header-h)_+_2rem)] sm:min-h-[min(720px,78svh)] sm:pb-10 lg:min-h-[min(740px,80svh)]">
          <div className={`${glass} w-full max-w-[620px] space-y-4 p-4 sm:p-6`}>
            <Skeleton className="h-6 w-32 rounded-full" />
            <Skeleton className="h-10 w-4/5 sm:h-14" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <div className="flex gap-2 pt-2">
              <Skeleton className="h-11 min-w-0 flex-1 rounded-full sm:max-w-52" />
              <Skeleton className="size-11 shrink-0 rounded-full" />
            </div>
          </div>
        </div>
      </div>
      <div className="shell pb-6 sm:pb-8">
        <div className="mb-4"><HeadingPreview /></div>
        <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={`${glass} flex min-w-0 items-center gap-3 rounded-2xl p-3`}>
              <Skeleton className="size-16 shrink-0 rounded-xl sm:size-[72px]" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3 w-4/5" /><Skeleton className="h-2.5 w-3/5" /><Skeleton className="h-4 w-16 rounded-md" />
              </div>
              <Skeleton className="size-8 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="shell section-pad">
        <div className="mb-5"><Skeleton className="h-11 w-56 max-w-full rounded-2xl" /></div>
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="w-[42vw] shrink-0 sm:w-[188px]"><PosterPreview /></div>)}
        </div>
      </div>
    </LoadingRegion>
  );
}

export function DetailLoadingPreview() {
  return (
    <LoadingRegion label="در حال بارگذاری اطلاعات انیمه و قسمت‌ها">
      <div className="relative -mt-[var(--header-h)] bg-gradient-to-bl from-amber-400/[0.045] to-transparent">
        <div className="shell pb-7 pt-[calc(var(--header-h)_+_1.75rem)] sm:pb-10 sm:pt-[calc(var(--header-h)_+_2.5rem)] lg:pb-12">
          <Skeleton className="h-3 w-40 max-w-full" />
          <div className="mt-7 grid items-end gap-8 lg:grid-cols-[1fr_272px] lg:gap-10">
            <div className="min-w-0 space-y-4">
              <Skeleton className="h-10 w-4/5 sm:h-14" /><Skeleton className="h-3 w-1/2" />
              <div className="flex flex-wrap gap-3"><Skeleton className="h-4 w-16" /><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-24" /></div>
              <div className="flex gap-2 pt-2"><Skeleton className="h-11 min-w-0 flex-1 rounded-full sm:max-w-52" /><Skeleton className="size-11 shrink-0 rounded-full" /></div>
              <Skeleton className={`h-11 w-full sm:w-52 ${glass}`} />
              <ChipsPreview />
            </div>
            <div className="order-first flex justify-center lg:order-last">
              <div className={`${glass} w-[164px] p-2 sm:w-[200px] lg:w-[272px]`}><Skeleton className="aspect-[17/24] rounded-2xl" /></div>
            </div>
          </div>
        </div>
      </div>
      <div className="shell pb-10 pt-9 sm:pt-11">
        <HeadingPreview />
        <div className={`${glass} mt-5 divide-y divide-white/[0.06] px-3 sm:px-5`}>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex min-w-0 items-center gap-3 py-4">
              <Skeleton className="size-9 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3 w-3/4 max-w-52" /><Skeleton className="h-2.5 w-1/2 max-w-32" /></div>
              <Skeleton className="h-9 w-16 shrink-0 rounded-full sm:w-24" />
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

export function AuthLoadingPreview() {
  return (
    <LoadingRegion label="در حال بارگذاری حساب کاربری">
      <div className="shell py-8 sm:py-12">
        <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-2 lg:gap-6">
          <div className={`${glass} space-y-5 p-5 sm:p-7`}>
            <HeadingPreview /><Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-11 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-xl" /><Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-11 w-full rounded-full" />
          </div>
          <Skeleton className="hidden min-h-[480px] rounded-3xl lg:block" />
        </div>
      </div>
    </LoadingRegion>
  );
}

export function AdminLoadingPreview() {
  return (
    <LoadingRegion label="در حال بارگذاری پنل مدیریت">
      <div className="shell space-y-6 py-8 sm:py-10">
        <HeadingPreview /><ChipsPreview />
        <div className={`${glass} space-y-4 p-5`}>
          <Skeleton className="h-11 w-full rounded-xl" />
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="flex items-center gap-3 border-t border-white/[0.06] pt-4"><Skeleton className="size-10 shrink-0 rounded-xl" /><Skeleton className="h-3 w-2/3" /><Skeleton className="ms-auto h-8 w-16 shrink-0 rounded-xl" /></div>)}
        </div>
      </div>
    </LoadingRegion>
  );
}

export function DocumentLoadingPreview() {
  return (
    <LoadingRegion label="در حال بارگذاری متن صفحه">
      <div className="shell max-w-3xl space-y-7 py-10">
        <HeadingPreview />
        {Array.from({ length: 3 }, (_, i) => <div key={i} className="space-y-3"><Skeleton className="h-5 w-40 max-w-full" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-[95%]" /><Skeleton className="h-3 w-3/4" /></div>)}
      </div>
    </LoadingRegion>
  );
}
