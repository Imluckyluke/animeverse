import { NextRequest, NextResponse } from "next/server";
import { unlinkNotification, validClientId } from "@/lib/notify-store";
import { isStoreUnavailable, storeUnavailable } from "@/lib/notify-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId") ?? "";
  if (!validClientId(clientId)) {
    return NextResponse.json({ error: "شناسهٔ دستگاه معتبر نیست." }, { status: 400 });
  }
  try {
    return NextResponse.json(await unlinkNotification(clientId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (isStoreUnavailable(error)) return storeUnavailable();
    throw error;
  }
}
