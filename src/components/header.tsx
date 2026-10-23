"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useApp } from "@/lib/app-context";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { InstallAppButton } from "@/components/install-app-button";
import { TelegramNotifyRow } from "@/components/telegram-notify-row";
import { useTelegramNotify } from "@/components/telegram-notify-provider";

const NAV = [
  { href: "/", label: "خانه" },
  { href: "/browse", label: "آرشیو" },
  { href: "/favorites", label: "علاقه‌مندی" },
];

const MENU_WIDTH = 236;
const CLOSE_MS = 520;

type MenuPhase = "closed" | "open" | "closing";

export function Header() {
  const pathname = usePathname();
  const { user, logout } = useApp();
  const { refresh: refreshNotifications } = useTelegramNotify();
  const [scrolled, setScrolled] = useState(false);
  const [menuPhase, setMenuPhase] = useState<MenuPhase>("closed");
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [menuAnchorX, setMenuAnchorX] = useState(MENU_WIDTH - 24);
  const [stem, setStem] = useState({ top: -11, height: 13 });
  const [outlineStart, setOutlineStart] = useState(-90);
  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null);
  const accountRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const menuOpen = menuPhase === "open";
  const menuMounted = menuPhase !== "closed";

  const nav = user ? [...NAV, { href: "/admin", label: "پنل ادمین" }] : NAV;

  const closeMenu = useCallback(() => {
    setMenuPhase((current) => (current === "closed" ? current : "closing"));
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setMenuPhase("closed");
      closeTimer.current = null;
    }, CLOSE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenuHost(document.body);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onResize = () => closeMenu();
    // Escape closes the popover and hands focus back to the account button.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu();
      accountRef.current?.focus();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, closeMenu]);

  // Start and finish the amber stroke at the point directly under the avatar,
  // instead of at the menu's top-left corner.
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const height = menuRef.current?.offsetHeight ?? 280;
    const dx = menuAnchorX - MENU_WIDTH / 2;
    setOutlineStart((Math.atan2(dx, Math.max(1, height / 2)) * 180) / Math.PI);
  }, [menuOpen, menuAnchorX]);

  useEffect(() => {
    closeMenu();
  }, [pathname, closeMenu]);

  // The popover lives in a portal at the end of <body>, so without this Tab
  // would skip straight past it. Focus the container and let Tab walk in.
  useEffect(() => {
    if (!menuOpen) return;
    const timer = window.setTimeout(() => menuRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [menuOpen]);

  const openMenu = () => {
    const button = accountRef.current;
    if (!button) return;
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    const rect = button.getBoundingClientRect();
    const headerBottom = button.closest("header")?.getBoundingClientRect().bottom ?? rect.bottom + 12;
    const top = headerBottom + 2;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 12));
    const anchor = Math.max(16, Math.min(MENU_WIDTH - 16, rect.left + rect.width / 2 - left));
    setMenuPos({ top, left });
    setMenuAnchorX(anchor);
    // The amber thread should physically start at the bottom edge of the
    // avatar, not at a fixed offset that changes with header height.
    const stemTop = Math.min(-4, Math.round(rect.bottom - top + 1));
    setStem({ top: stemTop, height: Math.max(8, Math.round(top - rect.bottom + 3)) });
    setOutlineStart((Math.atan2(anchor - MENU_WIDTH / 2, 140) * 180) / Math.PI);
    setMenuPhase("open");
    void refreshNotifications();
  };

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/browse") {
      return pathname === "/browse" || pathname.startsWith("/anime/") || pathname.startsWith("/search");
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-[70] px-3 pt-3 sm:px-4">
        <div
          className={cn(
            "mx-auto flex h-14 w-full max-w-[1280px] items-center justify-between gap-4 rounded-3xl border px-3 shadow-lift backdrop-blur-[6px] backdrop-saturate-150 transition-colors duration-500 sm:h-16 sm:px-6 lg:px-10",
            scrolled
              ? "border-white/[0.12] bg-[rgba(10,10,16,.48)] sm:bg-[rgba(10,10,16,.58)]"
              : "border-white/[0.09] bg-[rgba(10,10,16,.32)] sm:bg-[rgba(10,10,16,.32)]",
          )}
        >
          <Logo />

          <nav aria-label="منوی اصلی" className="hidden items-center gap-1 md:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(
                  "relative rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors duration-300",
                  isActive(item.href) ? "text-white" : "text-content-muted hover:text-white",
                )}
              >
                {item.label}
                {isActive(item.href) ? (
                  <span className="absolute inset-x-3.5 -bottom-[9px] h-[2px] rounded-full bg-amber-400" />
                ) : null}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {user ? (
              <div className="relative">
                <button
                  ref={accountRef}
                  type="button"
                  onClick={openMenu}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  aria-label={user ? `حساب ${user.name}` : "حساب کاربری"}
                  title="حساب کاربری"
                  className={cn(
                    "group grid size-10 shrink-0 place-items-center rounded-full outline-none transition-transform duration-200 hover:scale-[1.04] active:scale-95 focus-visible:ring-2 focus-visible:ring-amber-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950",
                    menuOpen && "scale-[1.04]",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-9 place-items-center rounded-full bg-amber-400 text-[#1a1206] shadow-[inset_0_1px_0_rgba(255,255,255,.28),0_8px_18px_-12px_rgba(255,214,10,.65)] ring-1 ring-white/15 transition-shadow duration-200",
                      menuOpen && "ring-2 ring-amber-200/40",
                    )}
                  >
                    <UserRound className="size-5" strokeWidth={2.2} />
                  </span>
                </button>
              </div>
            ) : (
              <Link href="/login" className="btn btn-glass btn-sm">
                ورود
              </Link>
            )}
          </div>
        </div>
      </header>

      {menuHost && menuPos && user && menuMounted
        ? createPortal(
            <>
              {menuOpen ? (
                <button
                  type="button"
                  aria-label="بستن منو"
                  className="fixed inset-0 z-[84] cursor-default"
                  onClick={closeMenu}
                />
              ) : null}
              <div
                role="menu"
                style={{ top: menuPos.top, left: menuPos.left }}
                className={cn(
                  "fixed z-[85] w-[236px] origin-top-left transition-[opacity,transform] duration-[460ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
                  menuPhase === "closing"
                    ? "pointer-events-none -translate-y-1.5 scale-[0.982] opacity-0"
                    : "opacity-100",
                )}
              >
                <span
                  aria-hidden
                  className="account-stem"
                  style={{ left: menuAnchorX, top: stem.top, height: stem.height }}
                />
                <span
                  aria-hidden
                  className="account-drop"
                  style={{ left: menuAnchorX }}
                />
                <div
                  ref={menuRef}
                  tabIndex={-1}
                  className="relative overflow-hidden rounded-2xl border border-white/[0.11] bg-[rgba(8,8,13,.82)] p-1.5 shadow-[0_24px_60px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-[18px] backdrop-saturate-[1.55]"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "account-outline pointer-events-none absolute inset-0 z-0 rounded-2xl",
                      menuPhase === "closing" && "account-outline-out",
                    )}
                    style={{ "--outline-start": `${outlineStart}deg` } as CSSProperties}
                  />
                  <div className={cn("relative z-10", menuOpen && "account-menu-enter")}>
                    <div className="border-b border-white/[0.06] px-3 pb-2.5 pt-2">
                      <p className="truncate text-xs font-bold text-white">{user.name}</p>
                      <p className="mt-0.5 truncate text-[10px] text-content-faint" dir="ltr">
                        {user.email}
                      </p>
                    </div>

                    <div className="border-b border-white/[0.06] py-1">
                      <TelegramNotifyRow variant="menu" />
                    </div>

                    <Link
                      href="/admin"
                      role="menuitem"
                      onClick={closeMenu}
                      className="mt-1 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs text-content-soft transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      <ShieldCheck className="size-3.5" />
                      پنل ادمین
                    </Link>
                    <Link
                      href="/login"
                      role="menuitem"
                      onClick={closeMenu}
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs text-content-soft transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      <UserRound className="size-3.5" />
                      حساب کاربری
                    </Link>
                    <div className="mt-1 border-t border-white/[0.06] pt-1">
                      <InstallAppButton variant="menu" />
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        logout();
                        closeMenu();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-right text-xs text-danger/80 transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <LogOut className="size-3.5" />
                      خروج از حساب
                    </button>
                  </div>
                </div>
              </div>
            </>,
            menuHost,
          )
        : null}
    </>
  );
}
