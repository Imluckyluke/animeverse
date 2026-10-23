"use client";

import { Bell, BellRing, Loader2, RefreshCw, Unlink } from "lucide-react";
import { cn, faNum } from "@/lib/utils";
import { useTelegramNotify } from "@/components/telegram-notify-provider";

/**
 * Telegram episode alerts. `menu` is the compact row inside the account
 * popover; `card` is the full-width settings block used on the account page.
 */
export function TelegramNotifyRow({ variant = "menu" }: { variant?: "menu" | "card" }) {
  const {
    ready,
    available,
    status,
    busy,
    pending,
    connect,
    setEnabled,
    refresh,
    disconnect,
  } = useTelegramNotify();
  if (!available) return null;
  const linked = Boolean(status?.linked);
  const enabled = linked && Boolean(status?.enabled);
  const menu = variant === "menu";

  const description = !ready
    ? "در حال بررسی اتصال…"
    : linked
      ? enabled
        ? `فعال · ${faNum(status?.favoritesCount ?? 0)} انیمه لایک‌شده`
        : "اتصال برقرار است، اعلان خاموش است"
      : pending
        ? "در تلگرام Start را بزن…"
        : "اتصال به ربات تلگرام";

  return (
    <div
      className={cn(
        menu ? "px-2 py-1.5" : "rounded-2xl border border-white/[0.09] bg-white/[0.035] p-3.5",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid shrink-0 place-items-center rounded-xl border",
            menu ? "size-8" : "size-10",
            linked && enabled
              ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
              : "border-white/10 bg-white/[0.045] text-content-muted",
          )}
        >
          {linked && enabled ? (
            <BellRing className={menu ? "size-3.5" : "size-[18px]"} />
          ) : (
            <Bell className={menu ? "size-3.5" : "size-[18px]"} />
          )}
        </span>

        <button
          type="button"
          onClick={() =>
            linked ? void setEnabled(!enabled) : pending ? void refresh() : void connect()
          }
          disabled={busy || !ready}
          className="min-w-0 flex-1 text-right disabled:opacity-60"
        >
          <span className={cn("block font-bold text-white", menu ? "text-[11px]" : "text-[12.5px]")}>
            اعلان قسمت جدید
          </span>
          <span className={cn("mt-0.5 block text-content-faint", menu ? "text-[9px]" : "text-[10.5px]")}>
            {description}
          </span>
        </button>

        {busy ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-amber-300" />
        ) : linked ? (
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={enabled ? "خاموش کردن اعلان قسمت جدید" : "روشن کردن اعلان قسمت جدید"}
            onClick={() => void setEnabled(!enabled)}
            className={cn(
              "flex h-6 w-10 shrink-0 items-center rounded-full border p-0.5 transition-colors",
              enabled
                ? "justify-end border-amber-300/50 bg-amber-400"
                : "justify-start border-white/15 bg-white/10",
            )}
          >
            <span
              className={cn(
                "block size-4 rounded-full shadow-sm transition-colors",
                enabled ? "bg-[#1a1206]" : "bg-white/70",
              )}
            />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => (pending ? void refresh() : void connect())}
            disabled={busy || !ready}
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-amber-400/30 bg-amber-400/10 text-amber-300 transition-colors hover:bg-amber-400/15 disabled:opacity-50"
            aria-label={pending ? "بررسی اتصال" : "اتصال به ربات تلگرام"}
            title={pending ? "بررسی اتصال" : "اتصال به ربات تلگرام"}
          >
            {pending ? <RefreshCw className="size-3.5" /> : <Bell className="size-3.5" />}
          </button>
        )}
      </div>

      {!menu && linked ? (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.07] pt-2.5">
          <p className="text-[10px] leading-5 text-content-faint">
            فقط برای انیمه‌هایی که قلبشان را زده‌ای پیام می‌آید.
          </p>
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
            className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-danger/75 transition-colors hover:text-danger disabled:opacity-50"
          >
            <Unlink className="size-3" />
            قطع اتصال
          </button>
        </div>
      ) : null}
    </div>
  );
}
