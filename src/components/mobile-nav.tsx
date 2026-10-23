"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Heart, Home, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/app-context";
import { cn, faNum } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "خانه", icon: Home },
  { href: "/browse", label: "آرشیو", icon: Compass },
  { href: "/favorites", label: "علاقه‌مندی", icon: Heart },
  { href: "/login", label: "حساب", icon: UserRound },
] as const;

export function MobileNav() {
  const pathname = usePathname();
  const { favorites } = useApp();
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY.current;
      if (Math.abs(delta) < 8) return;
      setHidden(delta > 0 && y > 80);
      lastY.current = y;
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setHidden(false);
    lastY.current = 0;
  }, [pathname]);

  return (
    <nav
      aria-label="ناوبری موبایل"
      className={cn(
        "fixed inset-x-3 z-[75] mx-auto max-w-[1280px] rounded-3xl border border-white/[0.1] bg-[rgba(10,10,16,.5)] shadow-lift backdrop-blur-[8px] backdrop-saturate-150 transition-[transform,opacity] duration-300 ease-out sm:inset-x-4 md:hidden",
        hidden
          ? "pointer-events-none translate-y-[calc(100%+1.5rem)] opacity-0"
          : "translate-y-0 opacity-100",
      )}
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
    >
      <div className="mx-auto grid h-[74px] w-full grid-cols-4 px-4 sm:px-6">
        {ITEMS.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`) ||
                (item.href === "/browse" && (pathname.startsWith("/anime/") || pathname.startsWith("/search")));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                 "relative flex flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-bold transition-colors",
                active ? "text-white" : "text-white/70 hover:text-white",
              )}
            >
              <span
                className={cn(
                  "relative grid size-9 place-items-center rounded-xl transition-all duration-300",
                  active && "bg-white/[0.08] shadow-inset",
                )}
              >
                <Icon className={cn("size-[18px]", active && "text-amber-300")} />
                {item.href === "/favorites" && favorites.length > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 grid min-w-[15px] place-items-center rounded-full bg-amber-400 px-1 text-[7px] font-black leading-[13px] text-ink-950">
                    {faNum(favorites.length)}
                  </span>
                ) : null}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
