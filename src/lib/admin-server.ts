import https from "node:https";
import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sameAdminOrigin, validControlPath, verifiedAdminOrigin } from "./admin-security";

const JSON_LIMIT = 2 * 1024 * 1024;
const COOKIE = (account: boolean) => (process.env.NODE_ENV === "production" ? "__Host-" : "") + (account ? "av_account_session" : "av_admin_session");
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
let originCache: { value: string; until: number } | undefined;

function response(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: PRIVATE_HEADERS }); }

async function controlOrigin(): Promise<string> {
  if (originCache && originCache.until > Date.now()) return originCache.value;
  const discovery = process.env.AV_ADMIN_DISCOVERY_URL;
  const secret = process.env.AV_ADMIN_SERVICE_TOKEN;
  if (!secret || !discovery || !/^https:\/\/raw\.githubusercontent\.com\/itisluckyluke-dev\/animeverse-temporary-downloads\/[^/]+\/admin-origin\.json$/.test(discovery)) throw new Error("Control service is not configured");
  const result = await fetch(discovery + "?v=" + Math.floor(Date.now() / 15000), { cache: "no-store", signal: AbortSignal.timeout(8000), redirect: "error" });
  if (!result.ok) throw new Error("Control discovery failed");
  const value = verifiedAdminOrigin(await result.json(), secret);
  originCache = { value, until: Date.now() + 15000 };
  return value;
}

async function bodyJson(request: NextRequest, media: boolean): Promise<Record<string, unknown> | undefined> {
  if (["GET", "HEAD", "DELETE"].includes(request.method)) return undefined;
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw Object.assign(new Error("درخواست باید JSON باشد."), { status: 415 });
  const limit = media ? 4_300_000 : 300_000;
  if (Number(request.headers.get("content-length")) > limit) throw Object.assign(new Error("حجم درخواست بیش از حد مجاز است."), { status: 413 });
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw Object.assign(new Error("حجم درخواست بیش از حد مجاز است."), { status: 413 }); }
      chunks.push(value);
    }
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw Object.assign(new Error("بدنهٔ درخواست معتبر نیست."), { status: 400 }); }
}

async function upstream(request: NextRequest, path: string, account: boolean, body?: Record<string, unknown>): Promise<{ status: number; json?: Record<string, unknown>; image?: Buffer }> {
  const origin = await controlOrigin();
  const cookie = request.cookies.get(COOKIE(true))?.value || "";
  if (cookie && !/^[A-Za-z0-9_-]{40,128}$/.test(cookie)) throw Object.assign(new Error("نشست معتبر نیست."), { status: 401 });
  const clientIp = (request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 200);
  const client = createHmac("sha256", process.env.AV_ADMIN_SERVICE_TOKEN!).update(clientIp).digest("hex");
  const data = body ? Buffer.from(JSON.stringify(body)) : undefined;
  const url = new URL("/v1/" + (account ? "account" : "admin") + path + request.nextUrl.search, origin);
  return new Promise((resolve, reject) => {
    const connection = https.request(url, { method: request.method, rejectUnauthorized: true, headers: {
      Authorization: "Bearer " + process.env.AV_ADMIN_SERVICE_TOKEN!, Accept: "application/json", "X-Client-Key": client,
      ...(cookie ? { "X-Session-Token": cookie } : {}),
      ...(request.headers.get("x-csrf-token") ? { "X-CSRF-Token": request.headers.get("x-csrf-token")! } : {}),
      ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}),
    } }, incoming => {
      const chunks: Buffer[] = []; let size = 0;
      const isImage = incoming.headers["content-type"] === "image/webp" && request.method === "GET" && /^\/media\/[a-f0-9]{64}\.webp$/.test(path);
      incoming.on("data", (chunk: Buffer) => { size += chunk.length; if (size > (isImage ? 4_000_000 : JSON_LIMIT)) connection.destroy(new Error("Control response too large")); else chunks.push(chunk); });
      incoming.on("error", reject);
      incoming.on("end", () => {
        const status = incoming.statusCode || 502;
        if (status >= 300 && status < 400) { reject(new Error("Control redirect rejected")); return; }
        const value = Buffer.concat(chunks);
        if (isImage && status === 200) { resolve({ status, image: value }); return; }
        try {
          const parsed = JSON.parse(value.toString()) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          resolve({ status, json: parsed as Record<string, unknown> });
        } catch { reject(new Error("Invalid control response")); }
      });
    });
    connection.setTimeout(20000, () => connection.destroy(new Error("Control timeout")));
    connection.on("error", reject); connection.end(data);
  });
}

export async function handleControl(request: NextRequest, parts: string[], account = false): Promise<NextResponse> {
  const path = "/" + parts.join("/");
  if (!validControlPath(path, account)) return response({ error: "مسیر مدیریتی پیدا نشد." }, 404);
  const mutating = !["GET", "HEAD"].includes(request.method);
  if (mutating && !sameAdminOrigin(request.url, request.headers.get("origin"))) return response({ error: "مبدأ درخواست مجاز نیست." }, 403);
  try {
    const result = await upstream(request, path, account, await bodyJson(request, path === "/media"));
    if (result.image) return new NextResponse(new Uint8Array(result.image), { status: 200, headers: { ...PRIVATE_HEADERS, "Content-Type": "image/webp" } });
    const json = result.json || {};
    const token = typeof json.token === "string" ? json.token : undefined;
    delete json.token;
    if (result.status >= 500) return response({ error: "سرویس مدیریت موقتاً در دسترس نیست؛ دوباره تلاش کن." }, 503);
    const anonymous = path === "/session" && request.method === "GET" && result.status === 401;
    const output = response(anonymous ? (account ? { user: null } : { session: null }) : json, anonymous ? 200 : result.status);
    const login = request.method === "POST" && (account ? ["/login", "/register", "/access"].includes(path) : path === "/session");
    if (token && login && result.status < 300) {
      if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) throw new Error("Invalid session transport");
      output.cookies.set(COOKIE(account), token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: account ? 30 * 86400 : 2 * 3600 });
    }
    if (anonymous || result.status === 401 || path === "/session" && request.method === "DELETE" || path === "/password" && result.status < 300) {
      output.cookies.set(COOKIE(account), "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
      if (!account && result.status < 300 && (path === "/session" && request.method === "DELETE" || path === "/password")) {
        output.cookies.set(COOKIE(true), "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
      }
    }
  return output;
  } catch (error) {
    originCache = undefined;
    const status = Number((error as { status?: number }).status) || 503;
    return response({ error: status < 500 ? (error as Error).message : "ارتباط با سرور مدیریت برقرار نشد؛ تغییرات را پیش از تکرار در تاریخچه بررسی کن." }, status);
  }
}

/** Server route gate: a browser email/local profile is never proof of ownership. */
export async function ownerAccountSession(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE(true))?.value;
  if (!token || !/^[A-Za-z0-9_-]{40,128}$/.test(token)) return false;
  try {
    const request = new NextRequest("https://animeverse-xi.vercel.app/api/account/session", { headers: { Cookie: COOKIE(true) + "=" + token } });
    const result = await upstream(request, "/session", true);
    const user = result.json?.user as { id?: string; role?: string } | undefined;
    return result.status === 200 && Boolean(user?.id) && user?.role === "owner";
  } catch { return false; }
}
