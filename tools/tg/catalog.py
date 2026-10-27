"""Turn the merged AniPlus state into the site's static catalog + live links map."""
from __future__ import annotations

import math
import re
from genres import normalize_genres
from quality import normalize_record, reported_year
from metadata import apply_metadata
from artwork import ROOT, read_json
from typing import Any
from urllib.parse import urlsplit

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
        return ""
    return fa_digits(value)


def _reported_score(anime: dict[str, Any]) -> tuple[float, str]:
    """Keep reported values, never replace absent/invalid ratings with a seed."""
    for field, source in (("scoreMal", "mal"), ("scoreAniplus", "aniplus")):
        raw = anime.get(field)
        if isinstance(raw, bool):
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError, OverflowError):
            continue
        if math.isfinite(value) and 0 < value <= 10:
            return value, source
    return 0, "unknown"


def _positive_int(raw: Any) -> int | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw if raw > 0 else None
    if isinstance(raw, str) and raw.isascii() and raw.isdigit():
        value = int(raw)
        return value if value > 0 else None
    return None


def _http_url(raw: Any) -> bool:
    if not isinstance(raw, str) or re.search(r"\s", raw):
        return False
    try:
        parsed = urlsplit(raw)
        return parsed.scheme.lower() in {"http", "https"} and bool(parsed.hostname)
    except ValueError:
        return False


def _source_post(anime: dict[str, Any]) -> dict[str, str]:
    """Only expose the known public metadata channel, never archive addresses."""
    number = _positive_int(anime.get("lastPostId"))
    if number is None:
        return {}
    # ingest.merge_post stores the latest metadata post's date as updatedAt.
    # This is title/post provenance, NOT any episode's release date.
    return {
        "sourcePostAt": anime.get("updatedAt") or "",
        "sourcePostUrl": f"https://t.me/aniplus/{number}",
    }


def _tagline(synopsis: str) -> str:
    clean = re.sub(r"\s+", " ", synopsis or "").strip()
    if not clean:
        return "دانلود با زیرنویس فارسی و کیفیت بالا"
    first = re.split(r"(?<=[.!؟?])\s+", clean)[0]
    return first[:130]


def _rewrite_year(anime: dict[str, Any]) -> int:
    return reported_year(anime)


def _qualities_of(anime: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    for qualities in (anime.get("episodes") or {}).values():
        labels.extend(qualities.keys())
    return ordered_qualities(labels)


def build_catalog(state: dict[str, Any]) -> list[dict[str, Any]]:
    queue = state.get("queue") or {}
    rows: list[dict[str, Any]] = []
    enrichment = read_json(ROOT / 'src/lib/generated-metadata.json', {}).get('metadata', {})

    for key, anime in (state.get("anime") or {}).items():
        anime = normalize_record(anime)
        # Metadata can announce episodes long before their files arrive. Keep
        # that inventory in canonical state, but never publish phantom download
        # rows or a title with no usable file.
        episodes_raw = {
            number: {
                label: deep for label, deep in labels.items()
                if (queue.get(deep) or {}).get("status") == "done"
                and _http_url((queue.get(deep) or {}).get("url"))
            }
            for number, labels in (anime.get("episodes") or {}).items()
        }
        episodes_raw = {number: labels for number, labels in episodes_raw.items() if labels}
        if not episodes_raw:
            continue
        episode_numbers = sorted(
            {number for raw in episodes_raw if (number := _positive_int(raw)) is not None}
        )
        if not episode_numbers:
            continue

        qualities = ordered_qualities(list({label for labels in episodes_raw.values() for label in labels}))
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
        highest_episode = max(episode_numbers)
        declared = _positive_int(anime.get("declaredEpisodes"))
        total_episodes = declared if declared is not None and declared >= highest_episode else None
        score, score_source = _reported_score(anime)
        duration = _duration(anime.get("durationRaw") or "")
        updated = anime.get("updatedAt") or ""

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
                    # The merged state has no episode-specific release provenance.
                    "releasedAt": "",
                    "qualities": items,
                }
            )

        ready_count = sum(
            any(item["status"] == "done" and _http_url(item.get("url")) for item in episode["qualities"])
            for episode in episode_data
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
                "scoreSource": score_source,
                **({"scoreReportedVia": "aniplus"} if anime.get("metadataSource") != "anilist" else {}),
                "votes": 0,
                # Compatibility count; only totalEpisodes claims a series total.
                "episodes": total_episodes if total_episodes is not None else len(episode_data),
                **({"totalEpisodes": total_episodes} if total_episodes is not None else {}),
                "availableEpisodes": len(episode_data),
                "indexedCount": len(episode_data),
                "readyCount": ready_count,
                "highestEpisode": highest_episode,
                "duration": duration,
                "type": anime.get("type") or "سریال",
                "format": anime.get("format") or "",
                "status": anime.get("status") or "در حال پخش",
                "studio": anime.get("studio") or "—",
                "producers": anime.get("producers") or "",
                "genres": normalize_genres(anime.get("genres")),
                "synopsis": synopsis,
                "tagline": _tagline(synopsis),
                "art": _art(key, title_ja),
                "quality": qualities,
                "audio": [] if anime.get("metadataSource") == "anilist" else ["زیرنویس فارسی"],
                "ageRating": anime.get("ageRating") or ("" if anime.get("metadataSource") == "anilist" else "+13"),
                "weeklyViews": 0,
                "popularity": 0,
                "updatedAt": updated,
                **_source_post(anime),
                "cover": anime.get("cover") or anime.get("coverUrl") or "",
                "banner": anime.get("banner") or anime.get("cover") or anime.get("coverUrl") or "",
                "source": "archive" if anime.get("metadataSource") == "anilist" else "aniplus",
                **({"metadataSource": "anilist", "metadataUrl": anime["metadataUrl"]} if anime.get("metadataSource") == "anilist" else {}),
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
    ranked = sorted(
        (item for item in rows if item["scoreSource"] != "unknown"),
        key=lambda item: item["score"], reverse=True,
    )[:10]
    for index, item in enumerate(ranked, start=1):
        item["rank"] = index
    for item in rows:
        item.pop("lastPostId", None)
        item.pop("firstPostId", None)
    return [apply_metadata(row, enrichment) for row in rows]


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
                if queued.get("status") != "done" or not _http_url(queued.get("url")):
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
