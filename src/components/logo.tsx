import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="انیمه‌ورس — صفحهٔ اصلی"
      className={cn("group flex shrink-0 items-center", className)}
    >
      {!compact ? (
        <span className="flex flex-col leading-none">
          <span className="text-[17px] font-black tracking-tight text-white sm:text-[18px]">
            انیمه<span className="gradient-text">ورس</span>
          </span>
          <span className="mt-1 text-[7px] font-bold uppercase tracking-[0.34em] text-content-faint">
            AnimeVerse
          </span>
        </span>
      ) : (
        <span className="text-[17px] font-black tracking-tight text-white">
          انیمه<span className="gradient-text">ورس</span>
        </span>
      )}
    </Link>
  );
}
