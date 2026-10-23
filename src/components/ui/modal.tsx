"use client";

import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * A lightweight sheet/dialog.
 *
 * The blurred backdrop is deliberately static: animating opacity on an
 * element with backdrop-filter makes mobile browsers paint the tint before
 * the blur (the "empty glass" flash). Only the tint and panel animate, and the
 * panel itself has an opaque surface so opening remains cheap.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }

    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [mounted, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-ink-950/55 backdrop-blur-[7px] backdrop-saturate-150"
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 bg-ink-950/35 transition-opacity duration-200 ease-out",
          visible ? "opacity-100" : "opacity-0",
        )}
      />
      <button
        type="button"
        aria-label="بستن"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative max-h-[88dvh] w-full overflow-y-auto overscroll-contain rounded-t-4xl border border-white/[0.12] bg-[linear-gradient(180deg,rgba(20,20,27,.98),rgba(14,14,20,.98))] p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-lift transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] sm:max-w-md sm:rounded-4xl sm:p-6",
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-5 scale-[0.985] opacity-0",
          className,
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-base font-extrabold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="grid size-9 place-items-center rounded-full border border-white/10 bg-white/5 text-content-muted transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
