"use client";

import { Bookmark, Check, ChevronDown, Clock3, Eye, Pause, Trash2 } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useApp } from "@/lib/app-context";
import { LIBRARY_LABELS, LIBRARY_STATUSES, type LibraryStatus } from "@/lib/library";
import { cn } from "@/lib/utils";

const DETAILS: Record<LibraryStatus, { icon: typeof Eye; hint: string }> = {
  watching: { icon: Eye, hint: "قسمت‌های جدیدش را دنبال می‌کنم" },
  planned: { icon: Clock3, hint: "در صف تماشای بعدی" },
  completed: { icon: Check, hint: "تماشای این عنوان تمام شده" },
  paused: { icon: Pause, hint: "فعلاً کنار گذاشته‌ام" },
};

type Position = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

export function LibraryControl({ slug, className }: { slug: string; className?: string }) {
  const { library, setLibraryStatus } = useApp();
  const status = library[slug] ?? "";
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  const place = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return false;
    const width = Math.min(Math.max(rect.width, 272), window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 20;
    const above = rect.top - 20;
    const flip = below < 330 && above > below;
    setPosition({
      left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      width,
      maxHeight: Math.max(80, flip ? above : below),
      ...(flip ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
    });
    return true;
  };
  const show = () => {
    // Opening a control cancels any in-flight anchor scroll before anchoring it.
    window.scrollTo({ top: window.scrollY, left: window.scrollX, behavior: "instant" });
    if (place()) setOpen(true);
  };

  useEffect(() => { close(); }, [slug]);

  useEffect(() => {
    if (!open) return;
    const options = menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const selected = menu.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    (selected ?? options?.[0])?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (target && !menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const resize = () => setOpen(false);
    let scrollFrame = 0;
    const scroll = (event: Event) => {
      if (menu.current?.contains(event.target as Node) || scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        const rect = trigger.current?.getBoundingClientRect();
        if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) setOpen(false);
        else place();
      });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(scrollFrame);
    };
  }, [open]);

  const choose = (value: LibraryStatus | null) => {
    setLibraryStatus(slug, value);
    close(true);
  };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === "Tab") { close(true); return; }
    const options = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (current + 1) % options.length
      : event.key === "ArrowUp" ? (current - 1 + options.length) % options.length
      : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); options[next]?.focus({ preventScroll: true }); }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="وضعیت در کتابخانه"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => open ? close() : show()}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); }
          else if (event.key === "Escape") close();
        }}
        className={cn("inline-flex h-11 min-w-0 items-center gap-2 rounded-xl border border-white/[0.14] bg-white/[0.045] px-3 text-right text-xs font-bold text-content-soft transition-colors hover:border-amber-400/30 focus-visible:border-amber-400/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/20", (status || open) && "border-amber-400/30 bg-amber-400/[0.055] text-amber-200", className)}
      >
        <Bookmark aria-hidden className={cn("size-4 shrink-0", status && "fill-amber-400/15")} />
        <span className="min-w-0 flex-1 truncate">{status ? LIBRARY_LABELS[status] : "افزودن به کتابخانه"}</span>
        <ChevronDown aria-hidden className={cn("ms-2 size-3.5 shrink-0 text-content-muted transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180 text-amber-300")} />
      </button>
      {open && position ? createPortal(
        <div ref={menu} id={id} role="listbox" aria-label="وضعیت در کتابخانه" dir="rtl" onKeyDown={navigate}
          data-side={position.bottom !== undefined ? "top" : "bottom"}
          className="library-menu fixed z-[180] overflow-y-auto overscroll-contain rounded-2xl p-1.5 text-right font-sans"
          style={position}>
          <div role="presentation" className="px-3 pb-2 pt-2 text-[10.5px] font-bold text-content-faint">جای این انیمه در کتابخانهٔ تو</div>
          {LIBRARY_STATUSES.map((key, index) => {
            const Icon = DETAILS[key].icon;
            const selected = status === key;
            return <Fragment key={key}>
              {index > 0 ? <div role="presentation" aria-hidden className="library-menu-divider" /> : null}
              <button type="button" role="option" aria-selected={selected} tabIndex={-1}
                onClick={() => choose(key)}
                className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right transition-colors duration-150 focus-visible:bg-white/[0.075] focus-visible:outline-none motion-reduce:transition-none", selected ? "bg-amber-400/10 text-amber-200" : "text-content-soft hover:bg-white/[0.05] hover:text-white")}>
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg border", selected ? "border-amber-400/25 bg-amber-400/10 text-amber-300" : "border-white/[0.08] bg-white/[0.025] text-content-muted")}><Icon aria-hidden className="size-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-xs font-bold">{LIBRARY_LABELS[key]}</span><span className="mt-1 block text-[10.5px] leading-4 text-content-muted">{DETAILS[key].hint}</span></span>
                {selected ? <Check aria-hidden className="size-4 shrink-0 text-amber-300" /> : null}
              </button>
            </Fragment>;
          })}
          {status ? <div role="presentation" className="mt-0.5"><div aria-hidden className="library-menu-divider" /><button type="button" role="option" aria-selected={false} tabIndex={-1} onClick={() => choose(null)} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-right text-xs font-bold text-content-muted transition-colors hover:bg-rose-400/[0.07] hover:text-rose-200 focus-visible:bg-rose-400/[0.07] focus-visible:text-rose-200 focus-visible:outline-none"><Trash2 aria-hidden className="size-4" />حذف دسته‌بندی</button></div> : null}
        </div>, document.body,
      ) : null}
    </>
  );
}
