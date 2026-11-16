import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
/** The old key-only process-spawning endpoint is intentionally retired. */
function retired() { return NextResponse.json({ error: "صفحه پیدا نشد." }, { status: 404, headers: { "Cache-Control": "no-store" } }); }
export { retired as GET, retired as POST };
