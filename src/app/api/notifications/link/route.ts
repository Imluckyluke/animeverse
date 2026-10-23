import { NextRequest, NextResponse } from "next/server";
import {
  createNotificationLink,
  normalizeFavorites,
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
  const payload = (body ?? {}) as { clientId?: unknown; favorites?: unknown };
  if (!validClientId(payload.clientId)) {
    return NextResponse.json({ error: "شناسهٔ دستگاه معتبر نیست." }, { status: 400 });
  }
  const favorites = normalizeFavorites(payload.favorites);
  const result = await createNotificationLink(payload.clientId, favorites);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
