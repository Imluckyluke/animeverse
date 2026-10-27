"use client";

import { Download, Send } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

export type DownloadMethod = "github" | "telegram";
const METHODS = [
  { value: "github", label: "دانلود مستقیم", icon: Download },
  { value: "telegram", label: "دانلود از تلگرام", icon: Send },
] as const;

export function DownloadMethodTabs({ id, value, onChange }: {
  id: string; value: DownloadMethod; onChange: (method: DownloadMethod) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const key = event.key;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
    event.preventDefault();
    // The first option is physically on the right in this RTL control.
    const next = key === "Home" ? 0 : key === "End" ? METHODS.length - 1
      : (index + (key === "ArrowLeft" ? 1 : -1) + METHODS.length) % METHODS.length;
    onChange(METHODS[next].value);
    buttons.current[next]?.focus();
  };
  return <div className="download-method-switch mb-5">
    <div role="tablist" aria-label="روش دانلود قسمت‌ها" dir="rtl" data-method={value} className="download-method-tabs">
      <span className="download-method-indicator" aria-hidden />
      {METHODS.map(({ value: method, label, icon: Icon }, index) => <button
        key={method} ref={node => { buttons.current[index] = node; }} type="button" role="tab"
        id={`${id}-${method}`} aria-selected={value === method} aria-controls={`${id}-panel`}
        tabIndex={value === method ? 0 : -1} onClick={() => onChange(method)}
        onKeyDown={event => navigate(event, index)} className="download-method-tab">
        <Icon className="size-4 shrink-0" aria-hidden /><span>{label}</span>
      </button>)}
    </div>
    <p className="download-method-description" aria-live="polite">
      {value === "github" ? "آماده‌سازی در سایت و دریافت فایل از گیت‌هاب" : "انتخاب کیفیت و رفتن مستقیم به همان فایل در تلگرام"}
    </p>
  </div>;
}
