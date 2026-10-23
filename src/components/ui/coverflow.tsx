"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, faDigits } from "@/lib/utils";

/** One case: most of a phone, a tidy 208px from tablet up. */
const CARD = "min(62vw, 208px)";

/**
 * Cover Flow: the row is a camera track. The case in the middle stands square
 * to the glass, its neighbours turn away, and the rest wait in the dark.
 *
 * Every case is the same width, so nothing re-flows while the row moves; the
 * only things that change are transforms. Native snap + `snap-always` lands a
 * gesture on exactly one anime, and the padded track lets the first and the
 * last case reach the middle.
 */
export function Coverflow<T extends { slug: string }>({
  items,
  renderCard,
  ariaLabel,
  className,
}: {
  items: T[];
  renderCard: (item: T, index: number) => ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const frame = useRef(0);

  /** The case nearest the middle of the track is the one standing square. */
  const read = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const mid = box.left + box.width / 2;
    let best = 0;
    let bestGap = Infinity;
    for (let index = 0; index < el.children.length; index += 1) {
      const rect = (el.children[index] as HTMLElement).getBoundingClientRect();
      const gap = Math.abs(rect.left + rect.width / 2 - mid);
      if (gap < bestGap) {
        bestGap = gap;
        best = index;
      }
    }
    setActive((prev) => (prev === best ? prev : best));
  }, []);

  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = 0;
      read();
    });
  }, [read]);

  useEffect(() => {
    read();
    window.addEventListener("resize", read);
    return () => {
      window.removeEventListener("resize", read);
      if (frame.current) window.cancelAnimationFrame(frame.current);
    };
  }, [read, items.length]);

  const goTo = useCallback(
    (index: number) => {
      const el = track.current;
      if (!el) return;
      const card = el.children[Math.max(0, Math.min(items.length - 1, index))] as
        | HTMLElement
        | undefined;
      if (!card) return;
      const box = el.getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      // Sign-agnostic: always travel the distance between the two centres, so
      // it is correct in RTL and in LTR alike.
      el.scrollTo({
        left: el.scrollLeft + (rect.left + rect.width / 2) - (box.left + box.width / 2),
        behavior: "smooth",
      });
    },
    [items.length],
  );

  const count = items.length;

  return (
    <div className={cn("group/flow relative", className)}>
      <div
        ref={track}
        role="group"
        tabIndex={0}
        aria-label={ariaLabel}
        onScroll={onScroll}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            goTo(active + 1);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            goTo(active - 1);
          }
        }}
        className="hide-scrollbar -mx-4 flex snap-x snap-mandatory gap-3.5 overflow-x-auto overflow-y-hidden py-5 focus-visible:outline-none sm:mx-0 sm:gap-4"
        style={{
          paddingInline: `calc(50% - ${CARD} / 2)`,
          scrollPaddingInline: `calc(50% - ${CARD} / 2)`,
          perspective: "1300px",
        }}
      >
        {items.map((item, index) => {
          const distance = index - active;
          const depth = Math.min(2, Math.abs(distance));
          return (
            <div
              key={item.slug}
              className="shrink-0"
              style={{
                width: CARD,
                scrollSnapAlign: "center",
                scrollSnapStop: "always",
                zIndex: 30 - depth,
                transformStyle: "preserve-3d",
                transform: `rotateY(${Math.max(-2, Math.min(2, distance)) * -21}deg) translateZ(${
                  depth === 0 ? 0 : -64
                }px) scale(${depth === 0 ? 1 : depth === 1 ? 0.93 : 0.87})`,
                opacity: depth === 2 ? 0.5 : 1,
                transition:
                  "transform .38s cubic-bezier(.22,1,.36,1), opacity .38s ease-out",
                willChange: "transform",
              }}
            >
              <div>{renderCard(item, index)}</div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        aria-label="قبلی"
        onClick={() => goTo(active - 1)}
        tabIndex={-1}
        className="absolute -right-2 top-1/2 z-40 hidden size-9 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-[#12121a]/90 text-white backdrop-blur-md transition hover:border-amber-300/50 lg:grid"
      >
        <ChevronRight className="size-4" />
      </button>
      <button
        type="button"
        aria-label="بعدی"
        onClick={() => goTo(active + 1)}
        tabIndex={-1}
        className="absolute -left-2 top-1/2 z-40 hidden size-9 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-[#12121a]/90 text-white backdrop-blur-md transition hover:border-amber-300/50 lg:grid"
      >
        <ChevronLeft className="size-4" />
      </button>

      <div className="mt-1 flex items-center justify-center gap-1.5" aria-hidden>
        {count <= 10
          ? items.map((item, index) => (
              <span
                key={item.slug}
                className={cn(
                  "h-1 rounded-full transition-all duration-300",
                  index === active ? "w-5 bg-amber-300" : "w-1.5 bg-white/20",
                )}
              />
            ))
          : null}
        <span className="ms-2 text-[10px] tabular-nums text-white/35">
          {faDigits(active + 1)}/{faDigits(count)}
        </span>
      </div>
    </div>
  );
}
