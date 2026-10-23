import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionHead({
  eyebrow,
  title,
  sub,
  href,
  linkLabel = "بیشتر",
  action,
  className,
  id,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  href?: string;
  linkLabel?: string;
  action?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn("mb-5 flex items-end justify-between gap-4 sm:mb-6", className)} id={id}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-2 flex items-center gap-2">
            <span className="h-px w-5 bg-gradient-to-l from-amber-400 to-transparent" />
            <span className="eyebrow">{eyebrow}</span>
          </div>
        ) : null}
        <h2 className="headline text-xl sm:text-2xl lg:text-[28px]">{title}</h2>
        {sub ? <p className="mt-1.5 text-xs leading-6 text-content-muted sm:text-[13px]">{sub}</p> : null}
      </div>
      {action ? (
        <div className="shrink-0">{action}</div>
      ) : href ? (
        <Link
          href={href}
          className="group inline-flex shrink-0 items-center gap-1.5 text-[12px] font-bold text-amber-300 transition-colors hover:text-white"
        >
          {linkLabel}
          <ArrowLeft className="size-3.5 transition-transform duration-300 group-hover:-translate-x-1" />
        </Link>
      ) : null}
    </div>
  );
}
