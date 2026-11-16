"use client";

import { useRef, type RefObject, type PointerEvent, type MouseEvent, type DragEvent } from "react";

/** Mouse dragging without swallowing taps, keyboard clicks or native touch scrolling. */
export function useDragScroll(ref: RefObject<HTMLDivElement | null>) {
  const gesture = useRef<{ x: number; left: number; id: number; moved: boolean; snap: string } | null>(null);
  const swallow = useRef(false);
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    const el = ref.current;
    if (!current || !el) return;
    gesture.current = null;
    if (el.hasPointerCapture(current.id)) el.releasePointerCapture(current.id);
    if (current.moved) {
      el.style.scrollSnapType = current.snap;
      el.style.cursor = "";
      swallow.current = event.type !== "pointercancel";
    }
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || (event.target as HTMLElement).closest("button,input,textarea,select")) return;
      const el = ref.current;
      if (!el) return;
      swallow.current = false;
      gesture.current = { x: event.clientX, left: el.scrollLeft, id: event.pointerId, moved: false, snap: el.style.scrollSnapType };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const current = gesture.current;
      const el = ref.current;
      if (!current || !el) return;
      const dx = event.clientX - current.x;
      if (!current.moved && Math.abs(dx) < 6) return;
      if (!current.moved) {
        current.moved = true;
        el.setPointerCapture(current.id);
        el.style.scrollSnapType = "none";
        el.style.cursor = "grabbing";
      }
      event.preventDefault();
      el.scrollLeft = current.left - dx;
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    onDragStart: (event: DragEvent<HTMLDivElement>) => event.preventDefault(),
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
      if (!swallow.current || event.detail === 0) return;
      swallow.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
