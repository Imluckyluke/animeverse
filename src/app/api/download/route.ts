import { NextResponse, type NextRequest } from "next/server";
import { getAnime } from "@/lib/data";
import { faDigits, faScore } from "@/lib/utils";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug") ?? "";
  const ep = Number(request.nextUrl.searchParams.get("ep") ?? "1");
  const quality = request.nextUrl.searchParams.get("q") ?? "1080p";
  const anime = getAnime(slug);

  if (!anime) {
    return NextResponse.json({ error: "anime not found" }, { status: 404 });
  }

  const safeQuality = ["4K", "1080p", "720p", "480p"].includes(quality) ? quality : "1080p";
  const episode = Number.isFinite(ep) && ep > 0 ? Math.min(ep, anime.episodes) : 1;

  const publicSite = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  const body = `\uFEFFانیمه‌ورس — AnimeVerse
====================================
عنوان: ${anime.titleEn}
عنوان فارسی: ${anime.title}
قسمت: ${faDigits(episode)}
کیفیت: ${safeQuality}
زیرنویس: ${anime.audio.join(" / ")}
استودیو: ${anime.studio}
امتیاز: ${faScore(anime.score)} از ۱۰

لینک فایل ویدیویی این قسمت در کانال تلگرام منتشر می‌شود:
https://t.me/testanivers

${publicSite ? `وب‌سایت: ${publicSite}\n` : ""}
`;

  const filename = `AnimeVerse-${anime.slug}-EP${String(episode).padStart(2, "0")}-${safeQuality}.txt`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
