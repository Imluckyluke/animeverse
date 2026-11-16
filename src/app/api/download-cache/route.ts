import { NextRequest, NextResponse } from "next/server";
import { getAnime } from "@/lib/data";
import { cacheConfigured, cacheRequest, downloadClientId } from "@/lib/download-cache";
import type { DownloadBatchReply } from "@/lib/download-cache-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...(status === 202 ? { "Retry-After": "4" } : {}) } });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return reply({ error: "درخواست از این مبدأ مجاز نیست." }, 403);
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 4096) return reply({ error: "درخواست نامعتبر است." }, 400);
    const input = JSON.parse(text) as { slug?: unknown; episode?: unknown; quality?: unknown; requestId?: unknown; all?: unknown };
    const bulk = input.all === true;
    if (typeof input.slug !== "string" || (!bulk && (typeof input.episode !== "number" || !Number.isInteger(input.episode) || input.episode <= 0)) ||
        typeof input.quality !== "string" || typeof input.requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId)) {
      return reply({ error: "درخواست نامعتبر است." }, 400);
    }
    const anime = getAnime(input.slug);
    const ip = request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for") || "unknown";
    const client = downloadClientId(ip.split(",")[0].trim());
    if (bulk) {
      const valid = anime?.episodeData?.some(ep => ep.qualities.some(q => q.label === input.quality && q.status === "done" && /^https:\/\/t\.me\/testanivers\/[1-9]\d*$/.test(q.url || "")));
      if (!valid) return reply({ error: "قسمت آماده‌ای با این کیفیت وجود ندارد." }, 404);
      if (!cacheConfigured()) return reply({ error: "دانلود گروهی روی سرور پیکربندی نشده است." }, 503);
      const response = await cacheRequest<DownloadBatchReply>("/v1/batches", { slug: input.slug, quality: input.quality, client, requestId: input.requestId });
      return reply(response.body, response.code);
    }
    const quality = anime?.episodeData?.find(ep => ep.number === input.episode)?.qualities.find(q => q.label === input.quality);
    if (quality?.status !== "done" || !/^https:\/\/t\.me\/testanivers\/[1-9]\d*$/.test(quality.url || "")) {
      return reply({ error: "این فایل در آرشیو آماده وجود ندارد." }, 404);
    }
    // Preserve the existing Telegram path until the new backend is configured.
    // A configured but failed GitHub service never silently redirects elsewhere.
    if (!cacheConfigured()) return reply({ status: "ready", provider: "telegram", url: quality.url, size: quality.size });
    const response = await cacheRequest("/v1/downloads", {
      slug: input.slug, episode: input.episode, quality: input.quality,
      client, requestId: input.requestId,
    });
    return reply(response.body, response.code);
  } catch (error) {
    return reply({ error: error instanceof SyntaxError ? "درخواست نامعتبر است." : "سرویس دانلود موقتاً در دسترس نیست؛ دوباره تلاش کن." }, error instanceof SyntaxError ? 400 : 503);
  }
}

export async function GET(request: NextRequest) {
  const job = request.nextUrl.searchParams.get("job") || "";
  const batch = request.nextUrl.searchParams.get("batch") || "";
  if (Boolean(job) === Boolean(batch) || !/^[a-f0-9]{64}$/.test(job || batch)) return reply({ error: "شناسهٔ درخواست معتبر نیست." }, 400);
  try {
    const response = await cacheRequest((batch ? "/v1/batches/" : "/v1/jobs/") + (batch || job));
    return reply(response.body, response.code);
  } catch { return reply({ error: "ارتباط با سرویس دانلود قطع شد؛ دوباره تلاش کن." }, 503); }
}

export async function PATCH(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return reply({ error: "درخواست مجاز نیست." }, 403);
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 1024) return reply({ error: "درخواست معتبر نیست." }, 400);
    const input = JSON.parse(text);
    if (!["pause", "resume"].includes(input.action) || !/^[a-f0-9]{64}$/.test(input.id || "") || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId || "") || typeof input.batch !== "boolean") return reply({ error: "درخواست معتبر نیست." }, 400);
    if (input.job !== undefined && (typeof input.job !== "string" || !/^[a-f0-9]{64}$/.test(input.job))) return reply({ error: "قسمت معتبر نیست." }, 400);
    const response = await cacheRequest("/v1/controls", input);
    return reply(response.body, response.code);
  } catch { return reply({ error: "تغییر وضعیت انجام نشد؛ دوباره تلاش کن." }, 503); }
}
