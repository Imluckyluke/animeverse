"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Children, cloneElement, isValidElement, useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useDragScroll } from "@/lib/use-drag-scroll";
import { CenteredCarousel } from "@/components/ui/centered-carousel";

/** Fraction of the viewport a plain (non-stepping) rail travels per arrow press. */
const PAGE = 0.72;
/** One wheel gesture may claim the rail for this long, in milliseconds. */
const WHEEL_LOCK = 520;

export function Rail(props: {
  children: ReactNode; className?: string; innerClassName?: string; ariaLabel?: string;
  stepping?: boolean; centered?: boolean; onActiveChange?: (index: number) => void;
}) {
  if (props.stepping && props.centered) {
    const items = Children.toArray(props.children);
    return <CenteredCarousel count={items.length} mode="cinema" ariaLabel={props.ariaLabel || "اسلایدر"} className={props.className} onIndexChange={props.onActiveChange}
      renderItem={(index, active) => isValidElement(items[index])
        ? cloneElement(items[index] as ReactElement<{ active?: boolean }>, { active }) : items[index]} />;
  }
  return <PlainRail {...props} />;
}

function PlainRail({
  children,
  className,
  innerClassName,
  ariaLabel,
  stepping = false,
  centered = false,
  onActiveChange,
}: {
  children: ReactNode;
  className?: string;
  /** Extra classes for the scroll track (padding for lifted cards/shadows). */
  innerClassName?: string;
  ariaLabel?: string;
  /** Stop on one card per gesture instead of free scrolling. */
  stepping?: boolean;
  /** The nearest card to the viewport centre is the resting/focused card. */
  centered?: boolean;
  /** Reports the focused card as the rail moves. */
  onActiveChange?: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useDragScroll(ref);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const middle = centered;
  const [pad, setPad] = useState(0);
  const activeRef = useRef(0);
  const onActive = useRef(onActiveChange);
  onActive.current = onActiveChange;

  // Focus is centre-based on every screen, but the first card still hugs the
  // leading shell edge. Do not add half-viewport gutters at either end.
  useEffect(() => {
    const el = ref.current;
    if (!el || !middle) {
      setPad(0);
      return;
    }
    const measure = () => {
      setPad(window.matchMedia("(min-width: 640px)").matches ? 0 : 16);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [middle]);

  /** Track geometry: the rail reads right to left, so offsets are negative. */
  const metrics = useCallback(() => {
    const el = ref.current;
    if (!el) return null;
    const rtl = getComputedStyle(el).direction === "rtl";
    const gap = parseFloat(getComputedStyle(el).columnGap || "0") || 0;
    const card = el.firstElementChild as HTMLElement | null;
    const stride = card
      ? card.getBoundingClientRect().width + gap
      : Math.max(280, el.clientWidth * PAGE);
    const last = Math.max(0, Math.round((el.scrollWidth - el.clientWidth) / stride));
    return { el, sign: rtl ? -1 : 1, stride, last };
  }, []);

  const indexAt = useCallback(() => {
    const el = ref.current;
    if (!el) return 0;
    if (middle) {
      const box = el.getBoundingClientRect();
      const mid = box.left + box.width / 2;
      let best = 0;
      let bestGap = Infinity;
      for (let i = 0; i < el.children.length; i += 1) {
        const rect = (el.children[i] as HTMLElement).getBoundingClientRect();
        const gap = Math.abs(rect.left + rect.width / 2 - mid);
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      }
      return best;
    }
    const m = metrics();
    if (!m) return 0;
    return Math.min(m.last, Math.max(0, Math.round((m.el.scrollLeft * m.sign) / m.stride)));
  }, [metrics, middle]);

  const goTo = useCallback(
    (index: number) => {
      const el = ref.current;
      if (!el) return;
      const card = el.children[Math.min(Math.max(index, 0), el.children.length - 1)] as
        | HTMLElement
        | undefined;
      if (!card) return;
      if (middle) {
        const box = el.getBoundingClientRect();
        const rect = card.getBoundingClientRect();
        el.scrollTo({
          left: el.scrollLeft + (rect.left + rect.width / 2) - (box.left + box.width / 2),
          behavior: "smooth",
        });
        return;
      }
      const m = metrics();
      if (!m) return;
      const to = Math.min(m.last, Math.max(0, index));
      m.el.scrollTo({ left: m.sign * to * m.stride, behavior: "smooth" });
    },
    [metrics, middle],
  );

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft);
    setCanPrev(pos > 6);
    setCanNext(pos < max - 6);
    if (!stepping) return;
    const index = indexAt();
    if (index === activeRef.current) return;
    activeRef.current = index;
    onActive.current?.(index);
  }, [stepping, indexAt]);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);

  // One gesture, one card: a trackpad flick must not fly past half the row.
  useEffect(() => {
    if (!stepping) return;
    const el = ref.current;
    if (!el) return;
    let until = 0;
    const onWheel = (event: WheelEvent) => {
      const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const delta = sideways ? event.deltaX : event.shiftKey ? event.deltaY : 0;
      // A plain vertical wheel still belongs to the page.
      if (!delta) return;
      event.preventDefault();
      const now = Date.now();
      if (now < until) return;
      until = now + WHEEL_LOCK;
      goTo(indexAt() + (delta > 0 ? 1 : -1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stepping, indexAt, goTo]);

  const scroll = (dir: "next" | "prev") => {
    if (stepping) {
      goTo(indexAt() + (dir === "next" ? 1 : -1));
      return;
    }
    const el = ref.current;
    if (!el) return;
    const amount = Math.max(280, el.clientWidth * PAGE);
    el.scrollBy({ left: dir === "next" ? -amount : amount, behavior: "smooth" });
  };

  return (
    <div className={cn("group/rail relative", className)}>
      <div
        ref={ref}
        {...drag}
        role="group"
        tabIndex={0}
        aria-label={ariaLabel}
        data-fade-left={canNext}
        data-fade-right={canPrev}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            scroll("next");
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            scroll("prev");
          }
        }}
        style={pad ? { paddingInline: pad, scrollPaddingInline: pad } : undefined}
        className={cn(
          "edge-feather hide-scrollbar -mx-4 flex cursor-grab select-none snap-x snap-mandatory gap-3.5 overflow-x-auto scroll-px-4 px-4 pb-2 sm:mx-0 sm:gap-4 sm:scroll-px-0 sm:px-0",
          innerClassName,
        )}
      >
        {children}
      </div>

      <button
        type="button"
        aria-label="قبلی"
        onClick={() => scroll("prev")}
        disabled={!canPrev}
        className={cn(
          "absolute -right-4 top-1/2 z-40 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-[#1a1a24]/90 text-white shadow-lift transition-all duration-300 hover:border-brand-400/50 hover:bg-brand-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300/70 focus-visible:opacity-100 lg:grid",
          canPrev
            ? "opacity-0 group-hover/rail:opacity-100 group-focus-within/rail:opacity-100"
            : "pointer-events-none opacity-0",
        )}
      >
        <ChevronRight className="size-4" />
      </button>
      <button
        type="button"
        aria-label="بعدی"
        onClick={() => scroll("next")}
        disabled={!canNext}
        className={cn(
          "absolute -left-4 top-1/2 z-40 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-[#1a1a24]/90 text-white shadow-lift transition-all duration-300 hover:border-brand-400/50 hover:bg-brand-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300/70 focus-visible:opacity-100 lg:grid",
          canNext
            ? "opacity-0 group-hover/rail:opacity-100 group-focus-within/rail:opacity-100"
            : "pointer-events-none opacity-0",
        )}
      >
        <ChevronLeft className="size-4" />
      </button>
    </div>
  );
}
