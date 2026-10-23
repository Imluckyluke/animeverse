import { NextRequest, NextResponse } from "next/server";
import {
  normalizeFavorites,
  updateNotificationPreferences,
  validClientId,
} from "@/lib/notify-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 400 });
  }
  const payload = (body ?? {}) as {
    clientId?: unknown;
    favorites?: unknown;
    enabled?: unknown;
  };
  if (!validClientId(payload.clientId)) {
    return NextResponse.json({ error: "شناسهٔ دستگاه معتبر نیست." }, { status: 400 });
  }
  const updates: { favorites?: string[]; enabled?: boolean } = {};
  if (payload.favorites !== undefined) updates.favorites = normalizeFavorites(payload.favorites);
  if (typeof payload.enabled === "boolean") updates.enabled = payload.enabled;
  const status = await updateNotificationPreferences(payload.clientId, updates);
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
