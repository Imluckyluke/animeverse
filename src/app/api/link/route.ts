import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { ANIME } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LinkRecord = {
  url?: string;
  size?: number | null;
  resolvedAt?: string;
};

let cache: { mtime: number; data: Record<string, LinkRecord> } = { mtime: 0, data: {} };

function readLinks(): Record<string, LinkRecord> {
  const file = path.join(process.cwd(), "data", "aniplus-links.json");
  try {
    const stat = fs.statSync(file);
    if (stat.mtimeMs !== cache.mtime) {
      cache = {
        mtime: stat.mtimeMs,
        data: JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, LinkRecord>,
      };
    }
    return cache.data;
  } catch {
    return {};
  }
}

export function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug") ?? "";
  const episode = Number(request.nextUrl.searchParams.get("ep") ?? "0");
  const quality = request.nextUrl.searchParams.get("q") ?? "";

  const anime = ANIME.find((item) => item.slug === slug && (item.source === "aniplus" || item.source === "archive"));
  if (!anime) {
    return NextResponse.json({ ok: false, status: "not-found" }, { status: 404 });
  }

  const episodeData = anime.episodeData?.find((item) => item.number === episode);
  const qualityData = episodeData?.qualities.find((item) => item.label === quality);
  if (!qualityData) {
    return NextResponse.json({ ok: false, status: "quality-not-found" }, { status: 404 });
  }

  const links = readLinks();
  const record = links[`${slug}|${episode}|${quality}`];
  const url = record?.url ?? qualityData.url;
  if (url) {
    return NextResponse.json(
      {
        ok: true,
        url,
        size: record?.size ?? qualityData.size ?? null,
        resolvedAt: record?.resolvedAt ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      status: qualityData.status === "failed" ? "failed" : "pending",
    },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
