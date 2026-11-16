import https from "node:https";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isCacheDownloadUrl, isSafeDownloadReply, type DownloadCacheReply, type DownloadBatchReply } from "./download-cache-contract";

const directCacheOrigin = process.env.AV_DIRECT_CACHE_ORIGIN ?? "https://anime.bayerkashan.ir";

export function cacheConfigured() {
  return Boolean(process.env.AV_DOWNLOAD_CACHE_TOKEN && (directCacheOrigin || process.env.AV_DOWNLOAD_CACHE_DISCOVERY_URL || process.env.AV_DOWNLOAD_CACHE_ORIGIN && process.env.AV_DOWNLOAD_CACHE_CA_PEM));
}

let cachedOrigin: { value: string; until: number } | undefined;

export function signedCacheOrigin(payload: unknown, secret: string, now = Date.now()) {
  const input = payload as { version?: unknown; origin?: unknown; updatedAt?: unknown; signature?: unknown };
  if (!input || input.version !== 1 || typeof input.origin !== "string" || typeof input.updatedAt !== "string" || typeof input.signature !== "string" || !/^[a-f0-9]{64}$/.test(input.signature)) throw new Error("نشانی سرویس دانلود تأیید نشد.");
  const url = new URL(input.origin);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname)) throw new Error("نشانی سرویس دانلود معتبر نیست.");
  const updated = Date.parse(input.updatedAt);
  if (!Number.isFinite(updated) || now - updated > 36 * 3600_000 || updated - now > 60_000) throw new Error("نشانی سرویس دانلود منقضی شده است.");
  const expected = createHmac("sha256", secret).update("1\n" + input.origin + "\n" + input.updatedAt).digest();
  if (!timingSafeEqual(expected, Buffer.from(input.signature, "hex"))) throw new Error("امضای نشانی دانلود معتبر نیست.");
  return input.origin;
}

async function currentOrigin() {
  if (directCacheOrigin) {
    const url = new URL(directCacheOrigin);
    if (url.protocol !== "https:" || url.hostname !== "anime.bayerkashan.ir" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) throw new Error("Download origin is not allowed");
    return url.origin;
  }
  const discovery = process.env.AV_DOWNLOAD_CACHE_DISCOVERY_URL;
  if (!discovery) return process.env.AV_DOWNLOAD_CACHE_ORIGIN!;
  if (cachedOrigin && cachedOrigin.until > Date.now()) return cachedOrigin.value;
  if (!/^https:\/\/raw\.githubusercontent\.com\/itisluckyluke-dev\/animeverse-temporary-downloads\/[^/]+\/cache-origin\.json$/.test(discovery)) throw new Error("پیکربندی کش معتبر نیست.");
  const response = await fetch(discovery + "?v=" + Math.floor(Date.now() / 30_000), { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("نشانی سرویس دانلود دریافت نشد.");
  const value = signedCacheOrigin(await response.json(), process.env.AV_DOWNLOAD_CACHE_TOKEN!);
  cachedOrigin = { value, until: Date.now() + 15_000 };
  return value;
}

export function downloadClientId(ip: string) {
  return createHmac("sha256", process.env.AV_DOWNLOAD_CACHE_TOKEN || "disabled").update(ip.slice(0, 200)).digest("hex");
}

/** Server-only TLS connection with a pinned private CA. No token/CA enters JS
 * shipped to browsers, and redirects never receive the shared authorization. */
export async function cacheRequest<T extends DownloadCacheReply | DownloadBatchReply = DownloadCacheReply>(path: string, payload?: Record<string, unknown>): Promise<{ code: number; body: T }> {
  if (!cacheConfigured()) throw new Error("سرویس دانلود هنوز پیکربندی نشده است.");
  if (!/^\/v1\/(downloads|batches|controls|(?:jobs|batches)\/[a-f0-9]{64})$/.test(path)) throw new Error("درخواست نامعتبر است.");
  const origin = new URL(await currentOrigin());
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/") throw new Error("پیکربندی سرویس دانلود معتبر نیست.");
  const data = payload ? JSON.stringify(payload) : undefined;
  return new Promise((resolve, reject) => {
    const request = https.request(new URL(path, origin), {
      method: data ? "POST" : "GET",
      ...(!directCacheOrigin && !process.env.AV_DOWNLOAD_CACHE_DISCOVERY_URL ? { ca: process.env.AV_DOWNLOAD_CACHE_CA_PEM!.replace(/\\n/g, "\n") } : {}),
      rejectUnauthorized: true,
      headers: {
        Authorization: "Bearer " + process.env.AV_DOWNLOAD_CACHE_TOKEN!,
        Accept: "application/json",
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
      },
    }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) request.destroy(new Error("پاسخ سرویس دانلود معتبر نیست."));
        else chunks.push(chunk);
      });
      response.on("error", () => reject(new Error("ارتباط با سرویس دانلود قطع شد.")));
      response.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString()) as T;
          const code = response.statusCode || 502;
          if (code >= 300 && code < 400) throw new Error("تغییر مسیر سرویس دانلود مجاز نیست.");
          if (code >= 400) {
            if (!body || !("error" in body) || typeof body.error !== "string" || body.error.length > 1200) throw new Error("پاسخ خطای سرویس دانلود معتبر نیست.");
            resolve({ code, body });
            return;
          }
          const items: DownloadCacheReply[] = "items" in body ? body.items : [body as DownloadCacheReply];
          if (!Array.isArray(items) || items.length > 2000 || items.some(item => !isSafeDownloadReply(item) || item.url !== undefined && !isCacheDownloadUrl(item.url))) throw new Error("آدرس دانلود تأیید نشد.");
          resolve({ code, body });
        } catch { reject(new Error("پاسخ سرویس دانلود معتبر نیست.")); }
      });
    });
    request.setTimeout(15000, () => request.destroy(new Error("سرویس دانلود دیر پاسخ داد؛ دوباره تلاش کن.")));
    request.on("error", () => reject(new Error("سرویس دانلود موقتاً در دسترس نیست.")));
    request.end(data);
  });
}
