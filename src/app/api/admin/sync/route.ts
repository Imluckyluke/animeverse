import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.env.AV_ROOT || process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const STATUS_FILE = path.join(DATA_DIR, "sync-status.json");
const STOP_FILE = path.join(DATA_DIR, "sync.stop");
const CATALOG_FILE = path.join(ROOT, "src", "lib", "real-catalog.json");
const LINKS_FILE = path.join(DATA_DIR, "aniplus-links.json");
// Server-only secret. Never expose it through NEXT_PUBLIC_* and never ship a
// default, otherwise anyone could trigger the heavy Telegram worker.
const ADMIN_KEY = process.env.ADMIN_KEY ?? "";

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function fileCount(file: string): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === "object") return Object.keys(parsed).length;
    return 0;
  } catch {
    return 0;
  }
}

function isAlive(pid?: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function authorised(request: NextRequest): boolean {
  if (!ADMIN_KEY) return false;
  const provided = request.headers.get("x-admin-key") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function missingKey() {
  return NextResponse.json(
    { error: "کلید مدیریت روی سرور تنظیم نشده است." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function statusPayload() {
  const status = readJson<Record<string, unknown>>(STATUS_FILE, {});
  const pid = Number(status.pid ?? 0);
  const alive = isAlive(pid);
  const state = String(status.state ?? "idle");
  const effective =
    !alive && (state === "running" || state === "watching") ? "error" : state === "" ? "idle" : state;
  return {
    ...status,
    state: effective,
    alive,
    serverNow: Date.now(),
    catalogCount: fileCount(CATALOG_FILE),
    linksCount: fileCount(LINKS_FILE),
    linkDelay: Number(process.env.AV_LINK_DELAY ?? 60),
    linkCooldown: Number(process.env.AV_LINK_COOLDOWN ?? 300),
    cooldownEvery: Number(process.env.AV_LINK_COOLDOWN_EVERY ?? 10),
    watchInterval: Number(process.env.AV_WATCH_INTERVAL ?? 300),
    ...(effective === "error" && (state === "running" || state === "watching")
      ? { error: "ورکر متوقف شده است (پروسه زنده نیست)." }
      : {}),
  };
}

export async function GET(request: NextRequest) {
  if (!ADMIN_KEY) return missingKey();
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  return NextResponse.json(statusPayload(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  if (!ADMIN_KEY) return missingKey();
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  let body: { posts?: number; watch?: boolean } = {};
  try {
    body = (await request.json()) as { posts?: number; watch?: boolean };
  } catch {
    body = {};
  }
  const posts = Math.max(1, Math.min(10000, Number(body.posts ?? 50)));
  if (!Number.isFinite(posts)) {
    return NextResponse.json({ error: "تعداد پست نامعتبر است" }, { status: 400 });
  }
  const watch = body.watch !== false;

  const status = readJson<Record<string, unknown>>(STATUS_FILE, {});
  const pid = Number(status.pid ?? 0);
  if (isAlive(pid)) {
    return NextResponse.json(
      { error: "یک همگام‌سازی در حال اجراست. اول آن را متوقف کن." },
      { status: 409 },
    );
  }

  try {
    fs.unlinkSync(STOP_FILE);
  } catch {
    // no stale stop flag
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const python = process.env.AV_PYTHON || "/usr/bin/python3";
  const script = path.join(ROOT, "tools", "tg", "sync.py");
  const jobId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const args = [script, "--posts", String(posts), "--job-id", jobId, watch ? "--watch" : "--no-watch"];
  const logFd = fs.openSync(path.join(DATA_DIR, "sync-stdout.log"), "a");
  try {
    const child = spawn(python, args, {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        AV_ROOT: ROOT,
        PYTHONUNBUFFERED: "1",
      },
    });
    child.unref();
    fs.closeSync(logFd);
    if (!child.pid) {
      return NextResponse.json({ error: "ورکر شروع نشد" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, jobId, pid: child.pid, posts, watch });
  } catch (error) {
    try {
      fs.closeSync(logFd);
    } catch {
      // ignore
    }
    return NextResponse.json(
      { error: `اجرای ورکر ناموفق بود: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
