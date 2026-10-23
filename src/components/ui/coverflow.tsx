"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, faDigits } from "@/lib/utils";
import { useDragScroll } from "@/lib/use-drag-scroll";

/** Snap geometry stays on the slots; only their inner artwork transforms. */
export function Coverflow<T extends { slug: string }>({
  items, renderCard, ariaLabel, className,
}: {
  items: T[];
  renderCard: (item: T, index: number) => ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const activeRef = useRef(0);
  const reduce = useRef(false);
  const [active, setActive] = useState(0);
  const [edges, setEdges] = useState({ prev: false, next: false });
  const drag = useDragScroll(track);
  const identity = items.map((item) => item.slug).join("|");

  const geometry = useCallback(() => {
    const el = track.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return null;
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const width = first.offsetWidth;
    const pad = parseFloat(style.paddingInlineStart) || 0;
    const anchor = style.direction === "rtl" ? box.right - pad - width / 2 : box.left + pad + width / 2;
    return { el, anchor, stride: width + (parseFloat(style.columnGap) || 0) };
  }, []);

  const read = useCallback(() => {
    const g = geometry();
    if (!g) return;
    const desktop = matchMedia("(min-width: 1024px)").matches;
    const position = Math.abs(g.el.scrollLeft);
    const prev = position > 2;
    const next = position < g.el.scrollWidth - g.el.clientWidth - 2;
    setEdges((current) => current.prev === prev && current.next === next ? current : { prev, next });
    let best = 0;
    let nearest = Infinity;
    Array.from(g.el.children).forEach((slot, index) => {
      const rect = slot.getBoundingClientRect();
      const delta = (rect.left + rect.width / 2 - g.anchor) / g.stride;
      if (Math.abs(delta) < nearest) { nearest = Math.abs(delta); best = index; }
      const art = slot.firstElementChild as HTMLElement | null;
      if (!art) return;
      const depth = Math.min(2, Math.abs(delta));
      const turn = Math.max(-2, Math.min(2, delta));
      // Follow the gesture continuously, without a transition chasing scroll.
      art.style.transform = reduce.current || desktop ? "none" :
        `perspective(1300px) rotateY(${turn * 18}deg) translateZ(${-depth * 28}px) scale(${1 - depth * 0.055})`;
      art.style.opacity = desktop ? "1" : String(1 - depth * 0.16);
    });
    activeRef.current = best;
    setActive((current) => current === best ? current : best);
  }, [geometry]);

  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; read(); });
  }, [read]);

  const goTo = useCallback((index: number) => {
    const g = geometry();
    if (!g) return;
    const slot = g.el.children[Math.max(0, Math.min(g.el.children.length - 1, index))];
    if (!slot) return;
    const rect = slot.getBoundingClientRect();
    g.el.scrollTo({
      left: g.el.scrollLeft + rect.left + rect.width / 2 - g.anchor,
      behavior: reduce.current ? "auto" : "smooth",
    });
  }, [geometry]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reduce.current = media.matches;
      const card = el.firstElementChild as HTMLElement | null;
      const edge = matchMedia("(min-width: 1024px)").matches ? 0 : Math.max(0, (el.clientWidth - (card?.offsetWidth ?? 208)) / 2);
      // Percent padding is relative to the containing block, not the bleeding
      // track itself. Use its measured width so both end cards really centre.
      el.style.setProperty("--flow-edge", `${edge}px`);
      read();
    };
    el.scrollLeft = 0;
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    media.addEventListener("change", sync);
    let until = 0;
    const wheel = (event: WheelEvent) => {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const delta = horizontal ? event.deltaX : event.shiftKey ? event.deltaY : 0;
      if (!delta || event.ctrlKey) return;
      event.preventDefault();
      if (Date.now() < until) return;
      until = Date.now() + 450;
      const next = horizontal ? (getComputedStyle(el).direction === "rtl" ? delta < 0 : delta > 0) : delta > 0;
      goTo(activeRef.current + (next ? 1 : -1));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      media.removeEventListener("change", sync);
      el.removeEventListener("wheel", wheel);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [identity, read, goTo]);

  if (!items.length) return null;
  return (
    <div className={cn("group/flow relative min-w-0", className)}>
      <div ref={track} {...drag} role="group" tabIndex={0} aria-label={ariaLabel} onScroll={onScroll}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          goTo(activeRef.current + (event.key === "ArrowLeft" ? 1 : -1));
        }}
        className="coverflow-track hide-scrollbar -mx-4 flex cursor-grab select-none snap-x snap-mandatory gap-3.5 overflow-x-auto overflow-y-hidden py-5 sm:mx-0 sm:gap-4">
        {items.map((item, index) => (
          <div key={item.slug} className="coverflow-slot shrink-0">
            <div className="origin-center">{renderCard(item, index)}</div>
          </div>
        ))}
      </div>
      <div aria-hidden className={cn("flow-fade flow-fade-right", edges.prev ? "opacity-100" : "opacity-0")} />
      <div aria-hidden className={cn("flow-fade flow-fade-left", edges.next ? "opacity-100" : "opacity-0")} />
      <button type="button" aria-label="قبلی" disabled={!edges.prev}
        onClick={() => goTo(activeRef.current - 1)}
        className="absolute -right-2 top-1/2 z-40 hidden size-11 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-[#12121a]/95 text-white transition-colors hover:border-amber-300/50 disabled:cursor-default disabled:opacity-30 lg:grid">
        <ChevronRight className="size-5" />
      </button>
      <button type="button" aria-label="بعدی" disabled={!edges.next}
        onClick={() => goTo(activeRef.current + 1)}
        className="absolute -left-2 top-1/2 z-40 hidden size-11 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-[#12121a]/95 text-white transition-colors hover:border-amber-300/50 disabled:cursor-default disabled:opacity-30 lg:grid">
        <ChevronLeft className="size-5" />
      </button>
      <p className="mt-1 text-center text-xs tabular-nums text-content-muted" aria-live="polite" aria-atomic="true">
        {faDigits(active + 1)} / {faDigits(items.length)}
      </p>
    </div>
  );
}
