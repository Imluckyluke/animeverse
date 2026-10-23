export function cn(...parts: unknown[]): string {
  return parts.filter(Boolean).map(String).join(" ");
}

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function faDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

export function faNum(value: number): string {
  return new Intl.NumberFormat("fa-IR").format(value);
}

/** Score with one decimal, Persian digits and the Persian decimal separator (۸٫۴). */
export function faScore(value: number): string {
  return new Intl.NumberFormat("fa-IR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function faCompact(value: number): string {
  return new Intl.NumberFormat("fa-IR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function faDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      timeZone: "Asia/Tehran",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - Date.parse(iso));
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "همین حالا";
  if (minutes < 60) return `${faNum(minutes)} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${faNum(hours)} ساعت پیش`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${faNum(days)} روز پیش`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${faNum(months)} ماه پیش`;
  return `${faNum(Math.floor(months / 12))} سال پیش`;
}

export function scoreTone(score: number): string {
  if (score >= 9) return "text-gold-300";
  if (score >= 8) return "text-gold-400";
  return "text-content-soft";
}

export function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "AV";
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join("");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function posterStyle(from: string, to: string) {
  return {
    backgroundImage: `linear-gradient(160deg, ${from} 0%, ${to} 100%)`,
  };
}

export function buildDownloadUrl(slug: string, episode: number, quality: string): string {
  const params = new URLSearchParams({
    slug,
    ep: String(episode),
    q: quality,
  });
  return `/api/download?${params.toString()}`;
}

export function triggerDownload(slug: string, episode: number, quality: string): void {
  const a = document.createElement("a");
  a.href = buildDownloadUrl(slug, episode, quality);
  a.rel = "noopener";
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}


export function faBytes(size?: number | null): string {
  if (!size || size <= 0) return "";
  const gb = size / 1024 ** 3;
  if (gb >= 1) {
    return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(gb)} گیگابایت`;
  }
  const mb = size / 1024 ** 2;
  return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(mb)} مگابایت`;
}

export type RealLinkResult = "done" | "pending" | "error";

/**
 * Opens a resolved @testanivers link. A blank tab is opened synchronously so
 * mobile browsers do not block it while /api/link is being fetched.
 */
export async function openRealDownload(
  slug: string,
  episode: number,
  quality: string,
): Promise<RealLinkResult> {
  if (typeof window === "undefined") return "error";
  const popup = window.open("", "_blank");
  try {
    const query = new URLSearchParams({
      slug,
      ep: String(episode),
      q: quality,
    });
    const response = await fetch(`/api/link?${query.toString()}`, { cache: "no-store" });
    let payload: { url?: string; status?: string } | null = null;
    try {
      payload = (await response.json()) as { url?: string; status?: string };
    } catch {
      payload = null;
    }
    if (response.ok && payload?.url) {
      if (popup) popup.location.href = payload.url;
      else window.location.href = payload.url;
      return "done";
    }
    popup?.close();
    if (payload?.status === "failed") return "error";
    return response.status === 202 ? "pending" : "error";
  } catch {
    popup?.close();
    return "error";
  }
}
