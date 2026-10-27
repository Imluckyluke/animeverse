import { NextResponse } from "next/server";
import { ANIME } from "@/lib/data";

export const dynamic = "force-static";

/** Public, lightweight search index. No episode payload or download links. */
export function GET() {
  return NextResponse.json(ANIME.map(({ slug, title, titleEn, titleJa, year, cover, banner }) => ({ slug, title, titleEn, titleJa, year, cover, banner })), {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
  });
}
