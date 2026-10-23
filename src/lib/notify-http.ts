import { NextResponse } from "next/server";
import { isStoreUnavailable } from "@/lib/notify-store";

/** Friendly response for hosts where the bot's shared store cannot be written. */
export function storeUnavailable() {
  return NextResponse.json(
    {
      error: "اعلانهای تلگرام روی این نسخه از سایت فعال نیست.",
      reason: "store-unavailable",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export { isStoreUnavailable };
