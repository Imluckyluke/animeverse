import { NextRequest } from "next/server";
import { handleControl } from "@/lib/admin-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) { return handleControl(request, (await context.params).path); }
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
