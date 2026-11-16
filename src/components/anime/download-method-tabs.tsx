"use client";
import { Check, ChevronDown, Download, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type DownloadMethod = "github" | "telegram";
const METHODS = [{ value: "github", label: "مستقیم", full: "دانلود مستقیم", icon: Download }, { value: "telegram", label: "تلگرام", full: "دانلود از تلگرام", icon: Send }] as const;

/** A small route picker beside the episode heading, not a separate content block. */
export function DownloadMethodTabs({ id, value, onChange }: { id: string; value: DownloadMethod; onChange: (value: DownloadMethod) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const selected = METHODS.find(method => method.value === value)!;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        const options = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || []);
        const index = options.indexOf(document.activeElement as HTMLButtonElement);
        options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", outside); root.current?.addEventListener("keydown", key);
    const element = root.current;
    return () => { document.removeEventListener("pointerdown", outside); element?.removeEventListener("keydown", key); };
  }, [open]);
  return <div ref={root} className="relative ms-auto shrink-0">
    <button ref={trigger} id={`${id}-${value}`} type="button" aria-label={`روش دانلود: ${selected.label}`} aria-haspopup="menu" aria-expanded={open} aria-controls={`${id}-menu`}
      onClick={() => setOpen(current => !current)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/[.055] px-3 text-[11px] font-bold text-content-soft shadow-inset transition-colors hover:bg-white/10">
      <selected.icon className="size-3.5 text-amber-300" /><span>{selected.label}</span><ChevronDown className={`size-3 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div id={`${id}-menu`} role="menu" aria-label="روش دانلود" className="download-route-menu absolute end-0 top-[calc(100%+8px)] z-40 min-w-48 rounded-2xl border border-white/15 p-1.5 shadow-2xl backdrop-blur-xl">
      {METHODS.map(method => <button type="button" key={method.value} role="menuitemradio" aria-checked={value === method.value} onClick={() => { onChange(method.value); setOpen(false); trigger.current?.focus(); }} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-start text-xs text-content-soft transition-colors hover:bg-white/10 focus-visible:bg-white/10"><method.icon className="size-3.5 text-amber-300" /><span className="flex-1">{method.full}</span>{value === method.value && <Check className="size-3 text-amber-300" />}</button>)}
    </div>}
  </div>;
}
