import { createHmac, timingSafeEqual } from "node:crypto";

export function sameAdminOrigin(requestUrl: string, origin: string | null): boolean {
  if (!origin) return false;
  try {
    const request = new URL(requestUrl), source = new URL(origin);
    return [request, source].every(url => ["https:", "http:"].includes(url.protocol) && !url.username && !url.password)
      && request.origin === source.origin && source.pathname === "/" && !source.search && !source.hash;
  } catch { return false; }
}

export function validControlPath(path: string, account = false): boolean {
  if (account) return /^\/(session|login|register|preferences|access|notifications\/(status|link|preferences|unlink))$/.test(path);
  return /^\/(session|overview|catalog(?:\/[a-z0-9][a-z0-9-]{0,199}(?:\/episodes)?)?|review(?:\/(?:preview|apply))?|imports\/(?:preview|[a-f0-9]{32}(?:\/confirm)?)|commands\/[a-f0-9-]{32,36}|history(?:\/\d{1,12}\/undo)?|users(?:\/[a-f0-9-]{32,36})?|settings|password|publish|backups|media(?:\/[a-f0-9]{64}\.webp)?)$/.test(path);
}

export function verifiedAdminOrigin(payload: unknown, secret: string, now = Date.now()): string {
  const item = payload as { version?: unknown; origin?: unknown; updatedAt?: unknown; signature?: unknown };
  if (!item || item.version !== 1 || typeof item.origin !== "string" || typeof item.updatedAt !== "string" || typeof item.signature !== "string" || !/^[a-f0-9]{64}$/.test(item.signature)) throw new Error("Invalid control discovery");
  const url = new URL(item.origin);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname)) throw new Error("Invalid control origin");
  const stamp = Date.parse(item.updatedAt);
  if (!Number.isFinite(stamp) || now - stamp > 36 * 3600_000 || stamp - now > 60_000) throw new Error("Expired control discovery");
  const expected = createHmac("sha256", secret).update("1\n" + item.origin + "\n" + item.updatedAt).digest();
  if (!timingSafeEqual(expected, Buffer.from(item.signature, "hex"))) throw new Error("Invalid control signature");
  return item.origin;
}
