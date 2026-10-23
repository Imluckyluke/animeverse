import { Skeleton } from "@/components/ui/skeleton";

export default function FavoritesLoading() {
  return (
    <div className="shell py-10">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-3 h-9 w-56" />
      <Skeleton className="mt-3 h-3 w-72" />
      <div className="mt-6 grid grid-cols-3 gap-3 sm:max-w-lg">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-2xl" />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="aspect-[2/3] w-full rounded-3xl" />
            <Skeleton className="h-3 w-2/3 rounded-full" />
            <Skeleton className="h-2.5 w-1/2 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
