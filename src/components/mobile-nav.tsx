"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Library, Home, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/app-context";
import { cn, faNum } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "خانه", icon: Home },
  { href: "/browse", label: "آرشیو", icon: Compass },
  { href: "/favorites", label: "کتابخانه", icon: Library },
  { href: "/login", label: "حساب", icon: UserRound },
] as const;

function syncDownloadLift(hidden: boolean) {
  // One small compositor translation, synchronized with the dock's 300ms
  // transition. Desktop overrides this lift because its dock is not displayed.
  document.documentElement.style.setProperty("--av-download-dock-lift", hidden ? "0px" : "88px");
}

export function MobileNav() {
  const pathname = usePathname();
  const { favorites, library, watched } = useApp();
  const libraryCount = new Set([...favorites, ...Object.keys(library), ...Object.keys(watched).filter(slug => watched[slug].length > 0)]).size;
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const lastHidden = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY.current;
      if (Math.abs(delta) < 8) return;
      const next = delta > 0 && y > 80;
      if (next !== lastHidden.current) {
        lastHidden.current = next; syncDownloadLift(next); setHidden(next);
      }
      lastY.current = y;
    };

    syncDownloadLift(lastHidden.current); onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); document.documentElement.style.removeProperty("--av-download-dock-lift"); };
  }, []);

  useEffect(() => {
    setHidden(false);
    lastHidden.current = false; syncDownloadLift(false);
    lastY.current = 0;
  }, [pathname]);

  return (
    <nav
      aria-label="ناوبری موبایل"
      className={cn(
        "mobile-dock glass-surface fixed inset-x-3 z-[75] mx-auto max-w-[1280px] rounded-3xl border border-white/[0.1] bg-[rgba(10,10,16,.5)] shadow-lift backdrop-blur-[8px] backdrop-saturate-150 transition-[transform,opacity] duration-300 ease-out sm:inset-x-4 md:hidden",
        hidden
          ? "pointer-events-none translate-y-[calc(100%+1.5rem)] opacity-0"
          : "translate-y-0 opacity-100",
      )}
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
    >
      <div className="dock-tray mx-auto grid h-[74px] w-full grid-cols-4 gap-1 p-1.5">
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
                "relative flex h-full w-full flex-col dock-item items-center justify-center gap-1 rounded-2xl px-2 text-[11px] font-bold transition-[transform,color] duration-150 active:scale-[.96] motion-reduce:transform-none",
                active ? "text-white" : "text-white/70 hover:text-white",
              )}
            >
              <span
                className={cn(
                  "dock-icon relative grid h-7 w-9 place-items-center rounded-xl transition-colors duration-200",
                )}
              >
                <Icon strokeWidth={active ? 2 : 1.7} className={cn("size-5", active && "text-amber-300")} />
                {item.href === "/favorites" && libraryCount > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 grid min-w-[15px] place-items-center rounded-full bg-amber-400 px-1 text-[7px] font-black leading-[13px] text-[#1a1206]">
                    {faNum(libraryCount)}
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
