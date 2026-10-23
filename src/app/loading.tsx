import { Skeleton, PosterSkeleton } from "@/components/ui/skeleton";

export default function HomeLoading() {
  return (
    <div>
      <div className="relative overflow-hidden">
        <Skeleton className="absolute inset-0 rounded-none opacity-40" />
        <div className="shell relative grid gap-10 py-10 lg:grid-cols-[1.15fr_.85fr] lg:py-16">
          <div className="max-w-2xl space-y-5">
            <Skeleton className="h-7 w-52 rounded-full" />
            <Skeleton className="h-16 w-[80%] sm:h-20" />
            <Skeleton className="h-3 w-64" />
            <Skeleton className="h-4 w-full max-w-lg" />
            <Skeleton className="h-4 w-[85%] max-w-md" />
            <div className="flex gap-3 pt-3">
              <Skeleton className="h-[52px] w-44 rounded-full" />
              <Skeleton className="h-[52px] w-48 rounded-full" />
            </div>
          </div>
          <Skeleton className="hidden aspect-[2/3] w-[300px] justify-self-center rounded-3xl lg:block" />
        </div>
      </div>

      <div className="shell -mt-4">
        <div className="glass-card grid grid-cols-2 gap-6 p-5 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-2.5 w-28" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="shell section-pad">
        <div className="mb-6 space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-7 w-48" />
        </div>
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <PosterSkeleton key={i} className="w-[43vw] shrink-0 sm:w-[190px]" />
          ))}
        </div>
      </div>
    </div>
  );
}
