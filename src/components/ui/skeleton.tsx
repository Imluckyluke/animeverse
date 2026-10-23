import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

export function PosterSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-3xl border border-white/[0.06]", className)}>
      <Skeleton className="aspect-[2/3] w-full rounded-none" />
      <div className="space-y-2 p-3">
        <Skeleton className="h-3.5 w-3/4 rounded-full" />
        <Skeleton className="h-2.5 w-1/2 rounded-full" />
      </div>
    </div>
  );
}

export function RowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <PosterSkeleton key={i} className="w-[42vw] shrink-0 sm:w-[188px]" />
      ))}
    </div>
  );
}
