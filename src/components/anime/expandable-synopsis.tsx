"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { synopsisLayout } from "@/lib/synopsis-layout";

/** Keep one copy of the text; measure it without clamping, animate its viewport. */
export function ExpandableSynopsis({ text }: { text: string }) {
  const id = useId();
  const content = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<ReturnType<typeof synopsisLayout> | null>(null);

  useEffect(() => {
    const node = content.current;
    if (!node) return;
    let alive = true;
    const mobile = matchMedia("(max-width: 639px)");
    const measure = () => {
      if (!alive) return;
      const next = synopsisLayout(node.getBoundingClientRect().height, parseFloat(getComputedStyle(node).lineHeight) || 28, mobile.matches);
      setLayout((previous) => previous && previous.full === next.full && previous.collapsed === next.collapsed && previous.expandable === next.expandable ? previous : next);
      if (!next.expandable) setOpen(false);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    mobile.addEventListener("change", measure);
    void document.fonts.ready.then(measure);
    return () => { alive = false; observer.disconnect(); mobile.removeEventListener("change", measure); };
  }, [text]);

  return <div className="mt-4 max-w-xl">
    <div id={id} data-measured={Boolean(layout)} className="synopsis-viewport"
      style={layout ? { height: open ? layout.full : layout.collapsed } : undefined}>
      <p ref={content} className="text-sm leading-7 text-white/75">{text}</p>
    </div>
    {layout?.expandable ? <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={id}
      className="flex min-h-11 items-center gap-2 text-sm font-bold text-amber-300">
      {open ? "بستن خلاصه" : "بیشتر دربارهٔ داستان"}
      <ChevronDown aria-hidden className={`size-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
    </button> : null}
  </div>;
}
