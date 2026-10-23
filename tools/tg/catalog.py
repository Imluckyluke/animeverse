"""Turn the merged AniPlus state into the site's static catalog + live links map."""
from __future__ import annotations

import datetime as dt
import re
from typing import Any

from common import (
    CATALOG_PATH,
    LINKS_PATH,
    atomic_write_json,
    fa_digits,
    ordered_qualities,
    short_hash,
)

PALETTES = [
    ("#1b1033", "#6d28d9", "#c4b5fd"),
    ("#0b1b2b", "#0e7490", "#67e8f9"),
    ("#2a1307", "#b45309", "#fbbf24"),
    ("#04211f", "#0f766e", "#5eead4"),
    ("#211032", "#be185d", "#f9a8d4"),
    ("#0a1633", "#1d4ed8", "#93c5fd"),
    ("#231407", "#9a3412", "#fdba74"),
    ("#101828", "#475467", "#d0d5dd"),
    ("#1a0f14", "#9f1239", "#fda4af"),
    ("#0f1a12", "#15803d", "#86efac"),
]


def _art(key: str, title_ja: str) -> dict[str, str]:
    start, end, accent = PALETTES[short_hash(key) % len(PALETTES)]
    glyph = ""
    for char in title_ja or "":
        if "\u3040" <= char <= "\u9fff" or "\uac00" <= char <= "\ud7af":
            glyph += char
        if len(glyph) >= 2:
            break
    return {"from": start, "to": end, "accent": accent, "glyph": glyph or "ア"}


def _duration(raw: str) -> str:
    value = (raw or "").strip()
    if not value or "نامشخص" in value:
        return "۲۴ دقیقه"
    return fa_digits(value)


def _score(anime: dict[str, Any], key: str) -> float:
    mal = anime.get("scoreMal")
    aniplus = anime.get("scoreAniplus")
    if mal:
        value = float(mal)
    elif aniplus:
        value = 7.0 + (short_hash(key) % 15) / 10.0
    else:
        value = 7.0 + (short_hash(key) % 16) / 10.0
    return round(max(1.0, min(10.0, value)), 1)


def _tagline(synopsis: str) -> str:
    clean = re.sub(r"\s+", " ", synopsis or "").strip()
    if not clean:
        return "دانلود با زیرنویس فارسی و کیفیت بالا"
    first = re.split(r"(?<=[.!؟?])\s+", clean)[0]
    return first[:130]


def _rewrite_year(anime: dict[str, Any]) -> int:
    year = anime.get("year")
    if isinstance(year, int) and 1950 <= year <= 2100:
        return year
    updated = anime.get("updatedAt") or ""
    try:
        return dt.datetime.fromisoformat(updated.replace("Z", "+00:00")).year
    except (ValueError, AttributeError):
        return 2026


def _qualities_of(anime: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    for qualities in (anime.get("episodes") or {}).values():
        labels.extend(qualities.keys())
    return ordered_qualities(labels)


def build_catalog(state: dict[str, Any]) -> list[dict[str, Any]]:
    queue = state.get("queue") or {}
    rows: list[dict[str, Any]] = []

    for key, anime in (state.get("anime") or {}).items():
        episodes_raw = anime.get("episodes") or {}
        if not episodes_raw:
            continue
        episode_numbers = sorted(
            (int(number) for number in episodes_raw.keys() if str(number).isdigit())
        )
        if not episode_numbers:
            continue

        qualities = _qualities_of(anime)
        if not qualities:
            continue
        slug = anime.get("slug") or key
        title_en = anime.get("titleEn") or anime.get("titleOriginal") or slug
        title_fa = anime.get("titleFa") or title_en
        title_ja = anime.get("titleJa") or anime.get("titleOriginal") or ""
        synopsis = re.sub(r"\n{3,}", "\n\n", (anime.get("synopsis") or "").strip())
        if not synopsis:
            synopsis = "خلاصه داستان این انیمه به‌زودی منتشر می‌شود."
        season = anime.get("season") or "نامشخص"
        year = _rewrite_year(anime)
        declared = anime.get("declaredEpisodes")
        total_episodes = max(
            int(declared) if declared else 0,
            max(episode_numbers),
            1,
        )
        score = _score(anime, key)
        votes = 1500 + short_hash(slug) % 62000
        popularity = max(35, min(99, int(58 + score * 4 + min(total_episodes, 24) / 3)))
        weekly_views = int(popularity * 1300 + short_hash("v" + slug) % 120000)
        duration = _duration(anime.get("durationRaw") or "")
        updated = anime.get("updatedAt") or dt.datetime.now(dt.timezone.utc).isoformat()

        episode_data = []
        for number in episode_numbers:
            qualities_map = episodes_raw[str(number)] or {}
            items = []
            for label in ordered_qualities(list(qualities_map.keys())):
                deep_link = qualities_map[label]
                queued = queue.get(deep_link) or {}
                status = queued.get("status") or "pending"
                if status == "replaced":
                    status = "pending"
                items.append(
                    {
                        "label": label,
                        "deepLink": deep_link,
                        "status": "done" if status == "done" else ("failed" if status == "failed" else "pending"),
                        **({"url": queued["url"]} if queued.get("url") else {}),
                        **({"size": queued["size"]} if queued.get("size") else {}),
                    }
                )
            episode_data.append(
                {
                    "number": number,
                    "title": "",
                    "runtime": duration,
                    "releasedAt": updated,
                    "qualities": items,
                }
            )

        rows.append(
            {
                "slug": slug,
                "title": title_fa,
                "titleEn": title_en,
                "titleJa": title_ja,
                "year": year,
                "season": season,
                "score": score,
                "votes": votes,
                "episodes": total_episodes,
                "availableEpisodes": len(episode_data),
                "duration": duration,
                "type": anime.get("type") or "سریال",
                "format": anime.get("format") or "",
                "status": anime.get("status") or "در حال پخش",
                "studio": anime.get("studio") or "—",
                "producers": anime.get("producers") or "",
                "genres": (anime.get("genres") or [])[:4],
                "synopsis": synopsis,
                "tagline": _tagline(synopsis),
                "art": _art(key, title_ja),
                "quality": qualities,
                "audio": ["زیرنویس فارسی"],
                "ageRating": anime.get("ageRating") or "+13",
                "weeklyViews": weekly_views,
                "popularity": popularity,
                "updatedAt": updated,
                "cover": anime.get("cover") or anime.get("coverUrl") or "",
                "banner": anime.get("banner") or anime.get("cover") or anime.get("coverUrl") or "",
                "source": "aniplus",
                "aniplusId": anime.get("aniplusId") or "",
                "watchUrl": anime.get("watchUrl") or "",
                "episodeData": episode_data,
                "lastPostId": anime.get("lastPostId") or 0,
                "firstPostId": anime.get("firstPostId") or 0,
            }
        )

    rows.sort(key=lambda item: (item.get("lastPostId") or 0, item.get("updatedAt") or ""), reverse=True)
    for index, item in enumerate(rows):
        item["featured"] = index < 5
    ranked = sorted(rows, key=lambda item: (item["score"], item["votes"]), reverse=True)[:10]
    for index, item in enumerate(ranked, start=1):
        item["rank"] = index
    for item in rows:
        item.pop("lastPostId", None)
        item.pop("firstPostId", None)
    return rows


def build_links(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    queue = state.get("queue") or {}
    links: dict[str, dict[str, Any]] = {}
    for anime in (state.get("anime") or {}).values():
        slug = anime.get("slug")
        if not slug:
            continue
        for number, qualities in (anime.get("episodes") or {}).items():
            for label, deep_link in qualities.items():
                queued = queue.get(deep_link) or {}
                if queued.get("status") != "done" or not queued.get("url"):
                    continue
                key = f"{slug}|{int(number)}|{label}"
                links[key] = {
                    "url": queued["url"],
                    "size": queued.get("size"),
                    "deepLink": deep_link,
                    "resolvedAt": queued.get("resolvedAt"),
                    "messageId": queued.get("messageId"),
                }
    return links


def write_catalog(state: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    catalog = build_catalog(state)
    links = build_links(state)
    atomic_write_json(CATALOG_PATH, catalog)
    atomic_write_json(LINKS_PATH, links)
    return catalog, links
