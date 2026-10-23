import { NextRequest, NextResponse } from "next/server";
import {
  createNotificationLink,
  normalizeFavorites,
  validClientId,
} from "@/lib/notify-store";
import { isStoreUnavailable, storeUnavailable } from "@/lib/notify-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 400 });
  }
  const payload = (body ?? {}) as { clientId?: unknown; favorites?: unknown };
  if (!validClientId(payload.clientId)) {
    return NextResponse.json({ error: "شناسهٔ دستگاه معتبر نیست." }, { status: 400 });
  }
  const favorites = normalizeFavorites(payload.favorites);
  try {
    const result = await createNotificationLink(payload.clientId, favorites);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isStoreUnavailable(error)) return storeUnavailable();
    throw error;
  }
}
