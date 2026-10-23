import { Skeleton } from "@/components/ui/skeleton";

export default function BrowseLoading() {
  return (
    <div>
      <div className="relative overflow-hidden border-b border-white/[0.05]">
        <Skeleton className="absolute inset-0 rounded-none opacity-25" />
        <div className="shell relative py-10">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="mt-4 h-10 w-[60%] max-w-sm" />
          <Skeleton className="mt-3 h-3.5 w-full max-w-lg" />
        </div>
      </div>
      <div className="shell py-8">
        <Skeleton className="h-14 w-full rounded-xl sm:h-16" />
        <div className="mt-4 flex gap-2 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 shrink-0 rounded-full" />
          ))}
        </div>
        <Skeleton className="mt-3 h-14 w-full rounded-xl" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[2/3] w-full rounded-3xl" />
              <Skeleton className="h-3 w-2/3 rounded-full" />
              <Skeleton className="h-2.5 w-1/2 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
