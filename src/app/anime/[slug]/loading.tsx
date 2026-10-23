import { Skeleton } from "@/components/ui/skeleton";

export default function AnimeLoading() {
  return (
    <div>
      <div className="relative overflow-hidden">
        <Skeleton className="absolute inset-0 rounded-none opacity-30" />
        <div className="shell relative pb-12 pt-8">
          <Skeleton className="h-3 w-40" />
          <div className="mt-7 grid gap-10 lg:grid-cols-[1fr_296px]">
            <div className="space-y-4">
              <div className="flex gap-2">
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-28 rounded-full" />
              </div>
              <Skeleton className="h-14 w-[80%]" />
              <Skeleton className="h-10 w-60" />
              <Skeleton className="h-4 w-full max-w-2xl" />
              <Skeleton className="h-4 w-[85%] max-w-xl" />
              <div className="flex gap-3 pt-3">
                <Skeleton className="h-[52px] w-52 rounded-full" />
                <Skeleton className="h-[52px] w-40 rounded-full" />
              </div>
            </div>
            <Skeleton className="hidden aspect-[2/3] rounded-3xl lg:block" />
          </div>
        </div>
      </div>

      <div className="shell py-10">
        <div className="mb-4 flex justify-between">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-6 w-32 rounded-full" />
        </div>
        <div className="overflow-hidden rounded-3xl border border-white/[0.06]">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-white/[0.05] p-4 last:border-0">
              <Skeleton className="size-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-52" />
                <Skeleton className="h-2.5 w-32" />
              </div>
              <Skeleton className="h-9 w-24 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
