import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.env.AV_ROOT || process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const STATUS_FILE = path.join(DATA_DIR, "sync-status.json");
const STOP_FILE = path.join(DATA_DIR, "sync.stop");
const ADMIN_KEY = process.env.ADMIN_KEY ?? "";

function authorised(request: NextRequest): boolean {
  if (!ADMIN_KEY) return false;
  const provided = request.headers.get("x-admin-key") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!ADMIN_KEY) {
    return NextResponse.json(
      { error: "کلید مدیریت روی سرور تنظیم نشده است." },
      { status: 503 },
    );
  }
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  let jobId = "";
  try {
    const status = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8")) as { jobId?: string };
    jobId = status.jobId ?? "";
  } catch {
    jobId = "";
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    STOP_FILE,
    JSON.stringify({ jobId, ts: new Date().toISOString() }),
    "utf8",
  );
  return NextResponse.json({ ok: true, jobId });
}
