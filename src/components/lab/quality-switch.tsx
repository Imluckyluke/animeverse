"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { label: "۱۰۸۰p", hint: "۱.۲ گیگابایت" },
  { label: "۷۲۰p", hint: "۶۴۰ مگابایت" },
  { label: "۴۸۰p", hint: "۳۱۰ مگابایت" },
  { label: "x265", hint: "۴۲۰ مگابایت" },
];

/**
 * A segmented control with a sliding amber lens: one selection, four sizes,
 * and the copy action confirms in place instead of throwing a toast.
 */
export function QualitySwitch() {
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const active = OPTIONS[index];

  return (
    <section className="rounded-[26px] border border-white/[0.11] bg-white/[0.025] p-4 backdrop-blur-md sm:p-5">
      <header className="mb-3 flex items-end justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-[0.16em] text-amber-300/80">کیفیت دانلود</p>
          <h3 className="mt-1 text-[15px] font-black text-white">قسمت ۳ — انتخاب کیفیت</h3>
        </div>
        <span className="text-[10.5px] text-white/40">{active.hint}</span>
      </header>

      <div
        role="tablist"
        aria-label="کیفیت"
        className="relative grid grid-cols-4 gap-1 rounded-2xl border border-white/[0.09] bg-black/35 p-1"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 w-[calc(25%-0.25rem)] rounded-xl border border-amber-300/45 bg-amber-400/[0.16] shadow-[0_0_18px_-6px_rgba(255,183,0,.75)] transition-[right] duration-300 ease-[cubic-bezier(.16,1,.3,1)]"
          style={{ right: `calc(${index} * 25% + 0.125rem)` }}
        />
        {OPTIONS.map((option, i) => (
          <button
            key={option.label}
            role="tab"
            aria-selected={i === index}
            onClick={() => setIndex(i)}
            className={cn(
              "relative z-10 rounded-xl py-2 text-[11.5px] font-black transition-colors duration-200",
              i === index ? "text-amber-100" : "text-white/50 hover:text-white/80",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-md flex-1 shadow-[0_18px_40px_-18px_rgba(255,183,0,.65)]"
        >
          <Download className="size-4" />
          دانلود {active.label}
        </button>
        <button
          type="button"
          onClick={() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
          aria-live="polite"
          className={cn(
            "btn btn-glass btn-md min-w-[7.5rem] gap-2 transition-colors",
            copied && "border-emerald-400/40 text-emerald-300",
          )}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "کپی شد" : "کپی لینک"}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[10px] text-white/35">
        <span className="inline-flex items-center gap-1">
          <Check className="size-3 text-emerald-400/80" />
          لینک مستقیم تلگرام
        </span>
        <span className="h-3 w-px bg-white/15" />
        <span>بدون تبلیغ</span>
      </div>
    </section>
  );
}
