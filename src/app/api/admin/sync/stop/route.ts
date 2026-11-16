import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
function retired() { return NextResponse.json({ error: "صفحه پیدا نشد." }, { status: 404, headers: { "Cache-Control": "no-store" } }); }
export { retired as POST };
