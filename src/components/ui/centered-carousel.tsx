"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent, type MouseEvent } from "react";
import { cn, faDigits } from "@/lib/utils";

/** One gesture = one item. Repeated visual banks let every item reach the
 * actual viewport centre without blank leading/trailing half-viewports.
 * Only the middle bank is interactive; settling teleports an identical bank
 * before the next paint, so there are never duplicate keyboard destinations.
 */
export function CenteredCarousel({ count, renderItem, ariaLabel, className, mode = "coverflow", onIndexChange }: {
  count: number;
  renderItem: (index: number, active: boolean) => ReactNode;
  ariaLabel: string;
  className?: string;
  mode?: "coverflow" | "cinema";
  onIndexChange?: (index: number) => void;
}) {
  const copies = count < 2 ? 1 : count < 3 ? 5 : 3;
  const base = Math.floor(copies / 2) * count;
  const track = useRef<HTMLDivElement>(null);
  const goal = useRef(base);
  const current = useRef(0);
  const frame = useRef(0);
  const motionFrame = useRef(0);
  const dragFrame = useRef(0);
  const geometry = useRef<{ origin: number; width: number; stride: number; sign: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selected, setSelected] = useState(base);
  const [ready, setReady] = useState(false);
  const onIndex = useRef(onIndexChange);
  onIndex.current = onIndexChange;
  const announced = useRef(-1);
  const pointer = useRef<{ x: number; y: number; id: number; left: number; start: number; stride: number; moved: boolean; dx: number } | null>(null);
  const swallow = useRef(false);
  const mod = useCallback((value: number) => count ? (value % count + count) % count : 0, [count]);
  useEffect(() => {
    const value = mod(selected - base);
    if (value !== announced.current) { announced.current = value; onIndex.current?.(value); }
  }, [selected, base, mod]);
  const warm = useCallback((logical: number) => {
    const radius = matchMedia("(min-width: 1024px)").matches ? 2 : 1;
    for (const slot of Array.from(track.current?.children || []) as HTMLElement[]) {
      const value = Number(slot.dataset.logicalIndex);
      const gap = Math.min(mod(value - logical), mod(logical - value));
      if (gap <= radius) slot.querySelectorAll("img").forEach(image => { image.loading = "eager"; });
    }
  }, [mod]);

  const read = useCallback(() => {
    const el = track.current;
    if (!el) return;
    if (!geometry.current) {
      const box = el.getBoundingClientRect(), mid = box.left + box.width / 2;
      const first = el.firstElementChild?.getBoundingClientRect();
      if (!first) return;
      const style = getComputedStyle(el);
      geometry.current = { origin: first.left + first.width / 2 - mid + box.width / 2 + el.scrollLeft,
        width: box.width, stride: first.width + (parseFloat(style.columnGap) || 0), sign: style.direction === "rtl" ? -1 : 1 };
    }
    const { origin, width, stride, sign } = geometry.current;
    let nearest = goal.current, distance = Infinity;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const desktop = matchMedia("(min-width: 1024px)").matches;
    const slots = Array.from(el.children) as HTMLElement[];
    // Cache invariant slot geometry on resize. Motion frames only read the
    // scroll offset, so artwork writes never force a fresh layout read.
    const scroll = el.scrollLeft;
    const deltas = slots.map((_slot, i) => {
      const delta = (origin - scroll + sign * i * stride - width / 2) / stride;
      if (Math.abs(delta) < distance) { distance = Math.abs(delta); nearest = i; }
      return delta;
    });
    slots.forEach((slot, i) => {
      const active = String(i === nearest);
      if (slot.dataset.flowActive !== active) slot.dataset.flowActive = active;
      const visible = Math.abs(deltas[i]) < 3;
      if (!visible && slot.dataset.motionVisible !== "true") return;
      slot.dataset.motionVisible = String(visible);
      const art = slot.firstElementChild as HTMLElement | null;
      if (!art) return;
      const depth = Math.min(2, Math.abs(deltas[i])), turn = Math.max(-2, Math.min(2, deltas[i]));
      art.style.transform = reduce ? "none" : mode === "cinema" ?
        `translateY(${-Math.max(0, 1 - depth) * 8}px) scale(${1 + Math.max(0, 1 - depth) * .02})` : desktop ? (i === nearest ? "translateY(-6px)" : "none") :
        `perspective(1300px) rotateY(${turn * 18}deg) translateZ(${-depth * 28}px) scale(${1 - depth * .055})`;
      art.style.opacity = desktop || mode === "cinema" ? "1" : String(1 - depth * .16);
    });
    current.current = mod(nearest - base);
    setSelected(value => value === nearest ? value : nearest);
  }, [base, mod, mode]);

  const centre = useCallback((index: number, smooth: boolean) => {
    const el = track.current;
    const slot = el?.children[index] as HTMLElement | undefined;
    if (!el || !slot) return;
    cancelAnimationFrame(motionFrame.current);
    motionFrame.current = 0;
    const box = el.getBoundingClientRect(), rect = slot.getBoundingClientRect();
    const from = el.scrollLeft;
    const left = from + rect.left + rect.width / 2 - box.left - box.width / 2;
    el.style.scrollBehavior = "auto";
    if (!smooth || Math.abs(left - from) < .5 || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.scrollLeft = left;
      return;
    }
    // A bounded glide is consistent for the wider cinema cards too. Native
    // smooth scrolling restarts its easing on every new gesture/release.
    const duration = Math.min(440, 200 + Math.abs(left - from) * .5);
    let started: number | null = null;
    const tick = (now: number) => {
      started ??= now;
      const t = Math.min(1, (now - started) / duration);
      el.scrollLeft = from + (left - from) * (1 - Math.pow(1 - t, 3));
      read();
      motionFrame.current = t < 1 ? requestAnimationFrame(tick) : 0;
    };
    motionFrame.current = requestAnimationFrame(tick);
  }, [read]);

  const settle = useCallback(() => {
    if (pointer.current?.moved || motionFrame.current) return;
    const logical = mod(goal.current - base);
    const canonical = base + logical;
    goal.current = canonical;
    centre(canonical, false);
    read();
  }, [base, mod, centre, read]);

  const go = useCallback((direction: number) => {
    if (count < 2) return;
    const el = track.current, metrics = geometry.current;
    const canonical = base + mod(goal.current - base);
    if (el && metrics && canonical !== goal.current) {
      // Shift to an identical bank at the current fractional position, not
      // to a card centre. Repeated quick swipes cannot exhaust the loop banks.
      el.scrollLeft += (canonical - goal.current) * metrics.sign * metrics.stride;
      goal.current = canonical;
      read();
    }
    // The goal, not the nearest card mid-animation, owns the gesture. This
    // prevents a flick/release from skipping two or stopping between items.
    goal.current = Math.max(0, Math.min(copies * count - 1, goal.current + direction));
    warm(mod(goal.current - base));
    centre(goal.current, true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(settle, 650);
  }, [count, copies, centre, settle, warm, mod, base, read]);

  useLayoutEffect(() => {
    const el = track.current;
    if (!el || !count) return;
    const sync = () => {
      geometry.current = null;
      const first = el.firstElementChild as HTMLElement;
      el.style.paddingInline = count === 1 ? `${Math.max(0, (el.clientWidth - first.offsetWidth) / 2)}px` : "0px";
      goal.current = base + mod(current.current);
      warm(mod(current.current));
      centre(goal.current, false);
      read();
      setReady(true);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => { observer.disconnect(); if (timer.current) clearTimeout(timer.current); cancelAnimationFrame(frame.current); cancelAnimationFrame(motionFrame.current); cancelAnimationFrame(dragFrame.current); };
  }, [count, base, mod, centre, read, warm]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let lastWheel = 0;
    let lastDirection = 0;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const delta = horizontal ? event.deltaX : event.shiftKey ? event.deltaY : 0;
      if (!delta) return; // Vertical scrolling still belongs to the page.
      event.preventDefault();
      const rtl = getComputedStyle(el).direction === "rtl";
      const direction = horizontal ? ((rtl ? delta < 0 : delta > 0) ? 1 : -1) : delta > 0 ? 1 : -1;
      const now = performance.now(), sameGesture = now - lastWheel < 350 && direction === lastDirection;
      lastWheel = now;
      lastDirection = direction;
      if (sameGesture) return;
      go(direction);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [go]);

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = pointer.current;
    pointer.current = null;
    const el = track.current;
    if (!gesture || !el) return;
    cancelAnimationFrame(dragFrame.current); dragFrame.current = 0;
    if (el.hasPointerCapture(gesture.id)) el.releasePointerCapture(gesture.id);
    if (!gesture.moved) {
      centre(goal.current, true);
      timer.current = setTimeout(settle, 650);
      return;
    }
    el.scrollLeft = gesture.left - Math.max(-gesture.stride * .9, Math.min(gesture.stride * .9, gesture.dx));
    swallow.current = true;
    const rtl = getComputedStyle(el).direction === "rtl";
    goal.current = gesture.start;
    go(event.type === "pointercancel" || Math.abs(gesture.dx) < 24 ? 0 : ((rtl ? gesture.dx > 0 : gesture.dx < 0) ? 1 : -1));
  };

  if (!count) return null;
  return <div className={cn("centered-carousel relative min-w-0", className)}>
    <div ref={track} role="group" tabIndex={0} aria-label={ariaLabel}
      data-centered-track data-track-ready={ready} data-count={count} data-index={mod(selected - base)}
      data-fade-left={count > 1} data-fade-right={count > 1}
      className={cn("centered-track edge-feather hide-scrollbar -mx-4 flex gap-3.5 overflow-x-auto overflow-y-hidden select-none sm:mx-0 sm:gap-4", mode === "coverflow" ? "coverflow-track py-5" : "py-6 sm:py-7")}
      onScroll={() => {
        if (motionFrame.current) return;
        if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; read(); });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(settle, 200);
      }}
      onKeyDown={event => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault(); go(event.key === "ArrowLeft" ? 1 : -1);
      }}
      onFocusCapture={event => {
        const target = event.target as HTMLElement;
        const slot = target.closest<HTMLElement>("[data-physical-index]");
        if (!slot || !target.matches(":focus-visible")) return;
        goal.current = Number(slot.dataset.physicalIndex);
        centre(goal.current, true);
      }}
      onPointerDown={event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if ((event.target as HTMLElement).closest("button,input,select,textarea")) return;
        const el = track.current;
        if (!el) return;
        swallow.current = false;
        if (timer.current) clearTimeout(timer.current);
        cancelAnimationFrame(motionFrame.current); motionFrame.current = 0;
        const start = goal.current;
        pointer.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, id: event.pointerId, start,
          stride: geometry.current?.stride ?? (el.firstElementChild as HTMLElement).offsetWidth, moved: false, dx: 0 };
      }}
      onPointerMove={event => {
        const gesture = pointer.current, el = track.current;
        if (!gesture || !el) return;
        const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
        if (!gesture.moved) {
          if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
            pointer.current = null;
            centre(goal.current, true);
            timer.current = setTimeout(settle, 650);
            return;
          }
          if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.1) return;
          gesture.moved = true; el.setPointerCapture(gesture.id);
        }
        event.preventDefault();
        gesture.dx = dx;
        if (!dragFrame.current) dragFrame.current = requestAnimationFrame(() => {
          dragFrame.current = 0;
          if (pointer.current !== gesture) return;
          el.scrollLeft = gesture.left - Math.max(-gesture.stride * .9, Math.min(gesture.stride * .9, gesture.dx));
          read();
        });
      }}
      onPointerUp={finish} onPointerCancel={finish}
      onLostPointerCapture={event => { if (event.target === event.currentTarget) finish(event); }}
      onDragStart={event => event.preventDefault()}
      onClickCapture={(event: MouseEvent<HTMLDivElement>) => { if (swallow.current && event.detail > 0) { swallow.current = false; event.preventDefault(); event.stopPropagation(); } }}>
      {Array.from({ length: count * copies }, (_, physical) => {
        const canonical = physical >= base && physical < base + count;
        return <div key={physical} data-carousel-slot data-logical-index={physical % count} data-physical-index={physical}
          aria-hidden={!canonical || undefined} ref={node => { node?.toggleAttribute("inert", !canonical); }}
          className={mode === "coverflow" ? "coverflow-slot shrink-0" : "shrink-0 w-[78vw] sm:w-[360px] lg:w-[400px]"}>
          <div className="origin-center">{renderItem(physical % count, physical === selected)}</div>
        </div>;
      })}
    </div>
    <button type="button" aria-label="قبلی" disabled={count < 2} onClick={() => go(-1)} className="icon-btn absolute -right-2 top-1/2 z-40 hidden size-11 -translate-y-1/2 lg:grid"><ChevronRight className="size-5" /></button>
    <button type="button" aria-label="بعدی" disabled={count < 2} onClick={() => go(1)} className="icon-btn absolute -left-2 top-1/2 z-40 hidden size-11 -translate-y-1/2 lg:grid"><ChevronLeft className="size-5" /></button>
    {mode === "coverflow" ? <p className="mt-1 text-center text-xs tabular-nums text-content-muted" aria-live="polite" aria-atomic="true">{faDigits(mod(selected - base) + 1)} / {faDigits(count)}</p> : null}
  </div>;
}
