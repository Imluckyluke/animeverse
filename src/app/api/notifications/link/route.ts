import { NextRequest } from "next/server";
import { handleControl } from "@/lib/admin-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function POST(request: NextRequest) {
  return handleControl(request, ["notifications", "link"], true);
}
