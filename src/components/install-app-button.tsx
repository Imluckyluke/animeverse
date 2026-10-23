"use client";

import { Check, Download, Share } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { usePwa } from "@/components/pwa-provider";
import { cn } from "@/lib/utils";

export function InstallAppButton({
  variant = "footer",
}: {
  variant?: "footer" | "menu" | "card";
}) {
  const { installed, install } = usePwa();
  const { toast } = useApp();

  const onClick = async () => {
    const result = await install();
    if (result === "ios") {
      toast(
        "نصب روی آیفون",
        "در Safari دکمهٔ اشتراک‌گذاری را بزن و «Add to Home Screen» را انتخاب کن.",
        "info",
      );
    } else if (result === "manual") {
      toast(
        "نصب اپ",
        "از منوی مرورگر گزینهٔ «Install app» یا «Add to Home Screen» را انتخاب کن.",
        "info",
      );
    } else if (result === "accepted") {
      toast("اپ نصب شد", "از این به بعد انیمه‌ورس را مثل یک اپ باز کن.");
    }
  };

  if (variant === "menu") {
    return (
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={installed}
        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-right text-xs text-content-soft transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-70"
      >
        {installed ? <Check className="size-3.5 text-emerald-300" /> : <Download className="size-3.5" />}
        {installed ? "اپ نصب شده" : "نصب اپ"}
      </button>
    );
  }

  if (variant === "card") {
    return (
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={installed}
        className="btn btn-glass btn-md w-full"
      >
        {installed ? <Check className="size-3.5 text-emerald-300" /> : <Download className="size-3.5" />}
        {installed ? "اپ روی دستگاه نصب است" : "نصب اپ روی صفحهٔ خانه"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={installed}
      className={cn(
        "group flex w-full min-w-0 items-center gap-3 rounded-2xl border border-white/[0.09] bg-white/[0.035] p-3 text-right transition-colors hover:border-amber-400/30 hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-75 sm:w-[15.5rem]",
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
        {installed ? <Check className="size-[18px]" /> : <Download className="size-[18px]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold text-content-faint">
          {installed ? "اپ نصب شده" : "اپ انیمه‌ورس"}
        </span>
        <span className="mt-0.5 block truncate text-[12px] font-extrabold text-white">
          {installed ? "از منوی دستگاه بازش کن" : "نصب روی صفحهٔ خانه"}
        </span>
      </span>
      {installed ? (
        <Check className="size-3.5 shrink-0 text-emerald-300" />
      ) : (
        <Share className="size-3.5 shrink-0 text-content-faint transition-colors group-hover:text-amber-300" />
      )}
    </button>
  );
}
