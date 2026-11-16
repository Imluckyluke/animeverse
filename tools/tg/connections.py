#!/usr/bin/env python3
"""Offline AniList relation/recommendation cache for the anime detail page.

Only public AniList metadata is fetched, and only for provider IDs that are
already verified in generated-metadata.json or by an explicit AniList
metadataUrl on a public catalogue row. No title fuzzy matching, no Telegram
credentials and no rendering-time network access.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import json
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = ROOT / "src/lib/real-catalog.json"
METADATA_PATH = ROOT / "src/lib/generated-metadata.json"
OVERRIDES_PATH = ROOT / "src/lib/admin-public-overrides.json"
OUTPUT_PATH = ROOT / "src/lib/generated-connections.json"
API_URL = "https://graphql.anilist.co"
USER_AGENT = "AnimeVerse-Connections/1.0"
MAX_RESPONSE = 8 * 1024 * 1024
MAX_RELATIONS = 30
MAX_RECOMMENDATIONS = 15
MAX_ENTRIES = 1200
MAX_SUPPORT_ENTRIES = 360
BATCH_SIZE = 50
DEFAULT_TTL_HOURS = 14 * 24

FORMATS = {"TV", "TV_SHORT", "MOVIE", "SPECIAL", "OVA", "ONA", "MUSIC"}
RELATION_TYPES = {
    "PREQUEL", "SEQUEL", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "PARENT",
    "SUMMARY", "COMPILATION", "CONTAINS", "OTHER",
}
ANILIST_URL = re.compile(r"^https://anilist\.co/anime/([1-9][0-9]*)/?$")

QUERY = """query ($ids: [Int]) {
  Page(page: 1, perPage: 50) {
    media(id_in: $ids, type: ANIME) {
      id type format seasonYear startDate { year }
      title { english romaji native }
      coverImage { large }
      relations {
        edges {
          relationType
          node {
            id type format seasonYear startDate { year }
            title { english romaji native }
            coverImage { large }
          }
        }
      }
      recommendations(perPage: 15, sort: RATING_DESC) {
        nodes {
          mediaRecommendation {
            id type format seasonYear startDate { year }
            title { english romaji native }
            coverImage { large }
          }
        }
      }
    }
  }
}"""


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def atomic_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".connections-", dir=str(path.parent))
    try:
        with open(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=1)
            handle.write("\n")
            handle.flush()
        Path(name).replace(path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            Path(name).unlink()


def iso_now(now: float | None = None) -> str:
    return dt.datetime.fromtimestamp(now or time.time(), dt.timezone.utc).isoformat(timespec="seconds")


def parse_iso(value) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def valid_id(value) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > 2_147_483_647:
        return None
    return value


def valid_year(value) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or not 1900 <= value <= 2100:
        return None
    return value


def metadata_provider_id(row, entry) -> int | None:
    """Exact generated-metadata identity only, mirroring metadata-enrichment.ts."""
    if not isinstance(entry, dict):
        return None
    identity = entry.get("identity") or {}
    if identity.get("titleEn") != row.get("titleEn"):
        return None
    if identity.get("titleJa", "") != (row.get("titleJa") or ""):
        return None
    data = entry.get("data") or {}
    row_year = valid_year(row.get("year"))
    provider_year = valid_year(data.get("year"))
    if row_year and provider_year and row_year != provider_year:
        return None
    return valid_id(entry.get("providerId"))


def metadata_url_provider_id(row) -> int | None:
    if row.get("metadataSource") != "anilist":
        return None
    match = ANILIST_URL.fullmatch(str(row.get("metadataUrl") or ""))
    return valid_id(int(match.group(1))) if match else None


def hidden_slugs(overrides) -> set[str]:
    """Only public overrides; private admin state is never read."""
    result = set()
    for slug, entry in ((overrides or {}).get("overrides") or {}).items():
        patch = (entry or {}).get("patch") or {}
        if patch.get("hidden") is True and isinstance(slug, str):
            result.add(slug)
    return result


def identity_snapshot(row) -> dict:
    return {
        "titleEn": str(row.get("titleEn") or ""),
        "titleJa": str(row.get("titleJa") or ""),
        "year": valid_year(row.get("year")) or 0,
    }


def verified_sources(rows, metadata, hidden=frozenset()) -> dict[int, list[dict]]:
    """Map verified provider IDs to public local identity snapshots.

    A row with conflicting metadata-derived and URL-derived IDs is ignored.
    Identical IDs from multiple local records are kept so the resolver can
    refuse ambiguous local links instead of choosing one title.
    """
    sources: dict[int, list[dict]] = {}
    for row in rows:
        slug = row.get("slug")
        if not isinstance(slug, str) or not slug or slug in hidden:
            continue
        metadata_id = metadata_provider_id(row, (metadata or {}).get(slug))
        url_id = metadata_url_provider_id(row)
        if metadata_id and url_id and metadata_id != url_id:
            continue
        provider_id = metadata_id or url_id
        if not provider_id:
            continue
        snapshot = identity_snapshot(row)
        bucket = sources.setdefault(provider_id, [])
        if snapshot not in bucket:
            bucket.append(snapshot)
    for bucket in sources.values():
        bucket.sort(key=lambda item: (item["titleEn"], item["titleJa"], item["year"]))
    return sources


def safe_cover(url) -> str:
    if not isinstance(url, str) or not url:
        return ""
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname != "s4.anilist.co"
            or parsed.username or parsed.password or parsed.port not in (None, 443)
            or not parsed.path.startswith("/file/anilistcdn/media/anime/cover/")):
        return ""
    return url


def pick_titles(node) -> tuple[str, str, str]:
    titles = node.get("title") or {}
    english = str(titles.get("english") or "").strip()
    romaji = str(titles.get("romaji") or "").strip()
    native = str(titles.get("native") or "").strip()
    return english or romaji or native, native, romaji


def node_snapshot(node) -> dict | None:
    """ANIME-only public snapshot; unknown/invalid nodes are dropped."""
    if not isinstance(node, dict) or node.get("type") != "ANIME":
        return None
    provider_id = valid_id(node.get("id"))
    if not provider_id:
        return None
    title_en, title_ja, title_romaji = pick_titles(node)
    if not title_en:
        return None
    year = (node.get("startDate") or {}).get("year") or node.get("seasonYear")
    return {
        "id": provider_id,
        "type": "ANIME",
        "titleEn": title_en,
        "titleJa": title_ja,
        "titleRomaji": title_romaji,
        "year": valid_year(year),
        "format": node.get("format") if node.get("format") in FORMATS else "",
        "cover": safe_cover((node.get("coverImage") or {}).get("large")),
    }


def bounded_relations(media, root_id: int) -> list[dict]:
    result, seen = [], set()
    edges = ((media.get("relations") or {}).get("edges") or [])
    if not isinstance(edges, list):
        return result
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        relation = str(edge.get("relationType") or "").upper()
        if relation not in RELATION_TYPES:
            continue
        node = node_snapshot(edge.get("node"))
        if not node or node["id"] == root_id or node["id"] in seen:
            continue
        seen.add(node["id"])
        result.append({"relationType": relation, "node": node})
        if len(result) >= MAX_RELATIONS:
            break
    return result


def bounded_recommendations(media, root_id: int) -> list[dict]:
    result, seen = [], set()
    nodes = ((media.get("recommendations") or {}).get("nodes") or [])
    if not isinstance(nodes, list):
        return result
    for item in nodes:
        if not isinstance(item, dict):
            continue
        node = node_snapshot(item.get("mediaRecommendation"))
        if not node or node["id"] == root_id or node["id"] in seen:
            continue
        seen.add(node["id"])
        result.append(node)
        if len(result) >= MAX_RECOMMENDATIONS:
            break
    return result


def cache_entry(media, sources, checked_at: str) -> dict | None:
    root = node_snapshot(media)
    if not root:
        return None
    provider_id = root["id"]
    identity = dict(root)
    identity["providerId"] = provider_id
    return {
        "sourceUrl": f"https://anilist.co/anime/{provider_id}",
        "checkedAt": checked_at,
        "identity": identity,
        "sources": sources,
        "relations": bounded_relations(media, provider_id),
        "recommendations": bounded_recommendations(media, provider_id),
    }


def entry_is_fresh(existing, provider_id: int, sources, now: float, ttl: float) -> bool:
    if not isinstance(existing, dict):
        return False
    identity = existing.get("identity") or {}
    if identity.get("providerId") != provider_id or identity.get("type") != "ANIME":
        return False
    if existing.get("sources") != sources:
        return False
    checked = parse_iso(existing.get("checkedAt"))
    return checked is not None and 0 <= now - checked < ttl


def is_support_entry(entry) -> bool:
    """An unbound external graph node used only to bridge verified local pages."""
    if not isinstance(entry, dict) or entry.get("support") is not True:
        return False
    if entry.get("sources"):
        return False
    identity = entry.get("identity") or {}
    return (identity.get("type") == "ANIME"
            and valid_id(identity.get("providerId")) == identity.get("id")
            and isinstance(entry.get("relations"), list))


def retry_after_seconds(value) -> int | None:
    """Parse both delta-seconds and HTTP-date Retry-After values."""
    text = str(value or "").strip()
    if text.isdigit():
        return max(1, int(text))
    if not text:
        return None
    try:
        when = parsedate_to_datetime(text)
        if when.tzinfo is None:
            when = when.replace(tzinfo=dt.timezone.utc)
        return max(1, int(when.timestamp() - time.time() + 0.999))
    except (TypeError, ValueError, OverflowError):
        return None


def fetch_batch(ids, blocked_until: float = 0, budget_end: float = 0) -> tuple[list[dict] | None, str, float]:
    """One bounded id_in request group, respecting Retry-After before retrying."""
    payload = json.dumps({"query": QUERY, "variables": {"ids": list(ids)}}).encode()
    last_error = "request-failed"
    for attempt in range(3):
        now = time.time()
        if now < blocked_until:
            return None, "rate-limited", blocked_until
        if budget_end and now >= budget_end:
            return None, "time-budget", blocked_until
        request = urllib.request.Request(
            API_URL, data=payload,
            headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise ValueError("oversized-response")
            result = json.loads(raw)
            if result.get("errors"):
                raise ValueError("graphql-errors")
            media = ((result.get("data") or {}).get("Page") or {}).get("media") or []
            return media if isinstance(media, list) else [], "ok", 0
        except urllib.error.HTTPError as error:
            last_error = f"http-{error.code}"
            if error.code == 429:
                wait = retry_after_seconds((error.headers or {}).get("Retry-After"))
                wait = wait if wait is not None else 60
                until = time.time() + wait
                if budget_end and until > budget_end:
                    return None, "rate-limited", until
                time.sleep(wait)
                blocked_until = until
                continue
            if error.code < 500:
                return None, last_error, blocked_until
            time.sleep(2 + attempt * 4)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            last_error = type(error).__name__
            time.sleep(2 + attempt * 4)
    return None, last_error, blocked_until


def enrich(rows, metadata, old, *, limit=MAX_ENTRIES, refresh=False,
           ttl_hours=DEFAULT_TTL_HOURS, max_requests=8, time_budget=90,
           overrides=None, now=None) -> dict:
    now = now or time.time()
    hidden = hidden_slugs(overrides)
    sources = verified_sources(rows, metadata, hidden)
    old_entries = old.get("entries") if isinstance(old, dict) else {}
    old_entries = old_entries if isinstance(old_entries, dict) else {}
    entries = {str(key): value for key, value in old_entries.items()
               if str(key).isdigit() and valid_id(int(key)) is not None
               and not is_support_entry(value)}
    support_entries = {str(key): value for key, value in old_entries.items()
                       if str(key).isdigit() and valid_id(int(key)) is not None
                       and is_support_entry(value)}

    todo = []
    for provider_id, snapshots in sources.items():
        existing = entries.get(str(provider_id))
        if refresh or not entry_is_fresh(existing, provider_id, snapshots, now, ttl_hours * 3600):
            todo.append(provider_id)
    cached_ids = {int(key) for key in entries}
    todo.sort(key=lambda value: (value in cached_ids, value))

    provider_state = (old.get("providerState") if isinstance(old, dict) else {}) or {}
    blocked_until = float(provider_state.get("blockedUntil") or 0)
    checked_at = iso_now(now)
    attempted = fetched = failed = 0
    request_count = 0
    status = "ok"
    budget_end = now + max(0, time_budget)
    missing = []

    if blocked_until > time.time():
        status = "rate-limited"
    else:
        for start in range(0, min(len(todo), limit), BATCH_SIZE):
            batch = todo[start:start + BATCH_SIZE]
            if request_count >= max_requests:
                status = "partial"
                break
            if time.time() >= budget_end:
                status = "partial"
                break
            media, error, blocked_until = fetch_batch(batch, blocked_until, budget_end)
            request_count += 1
            attempted += len(batch)
            if media is None:
                failed += len(batch)
                status = "rate-limited" if error == "rate-limited" else "partial"
                break
            returned = {item.get("id"): item for item in media if isinstance(item, dict)}
            for provider_id in batch:
                snapshots = sources[provider_id]
                media_node = returned.get(provider_id)
                if not media_node:
                    missing.append(provider_id)
                    entries.pop(str(provider_id), None)
                    continue
                entry = cache_entry(media_node, snapshots, checked_at)
                if not entry or entry["identity"]["providerId"] != provider_id:
                    failed += 1
                    existing = entries.get(str(provider_id))
                    if existing and existing.get("sources") == snapshots:
                        continue
                    entries.pop(str(provider_id), None)
                    continue
                entries[str(provider_id)] = entry
                fetched += 1
            if time.time() >= budget_end:
                status = "partial"
                break
            if start + BATCH_SIZE < min(len(todo), limit):
                time.sleep(1.5)

    source_keys = {str(value) for value in sources}
    entries = {key: entries[key] for key in sorted(entries, key=lambda value: int(value)) if key in source_keys}
    local_cached = len(entries)

    kept_support = {}
    for key in sorted(support_entries, key=lambda value: int(value)):
        if key in source_keys:
            continue
        if len(kept_support) >= MAX_SUPPORT_ENTRIES:
            status = "bounded"
            break
        kept_support[key] = support_entries[key]
    for key, value in kept_support.items():
        if len(entries) >= MAX_ENTRIES:
            status = "bounded"
            break
        entries[key] = value
    entries = {key: entries[key] for key in sorted(entries, key=lambda value: int(value))}

    latest = max((entry.get("checkedAt") for entry in entries.values() if entry.get("checkedAt")), default=None)
    provider_state = {"blockedUntil": int(blocked_until) if blocked_until > time.time() else 0}
    if provider_state["blockedUntil"]:
        provider_state["reason"] = "HTTP 429 Retry-After"

    return {
        "version": 1,
        "provider": "anilist",
        "checkedAt": latest,
        "status": status,
        "coverage": {
            "verifiedLocalIds": len(sources),
            "cachedIds": local_cached,
            "supportIds": len(entries) - local_cached,
        },
        "providerState": provider_state,
        "entries": entries,
        "_report": {
            "verified": len(sources), "cached": local_cached, "support": len(entries) - local_cached,
            "todo": len(todo), "attempted": attempted, "fetched": fetched, "failed": failed,
            "missing": missing, "requests": request_count, "status": status,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=MAX_ENTRIES)
    parser.add_argument("--ttl-hours", type=float, default=DEFAULT_TTL_HOURS)
    parser.add_argument("--max-requests", type=int, default=8)
    parser.add_argument("--time-budget", type=float, default=90)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()

    rows = read_json(CATALOG_PATH, [])
    metadata = (read_json(METADATA_PATH, {}) or {}).get("metadata") or {}
    overrides = read_json(OVERRIDES_PATH, {})
    old = read_json(OUTPUT_PATH, {"version": 1, "entries": {}})
    result = enrich(
        rows if isinstance(rows, list) else [], metadata, old,
        limit=max(0, min(args.limit, MAX_ENTRIES)), refresh=args.refresh,
        ttl_hours=max(0, args.ttl_hours), max_requests=max(0, args.max_requests),
        time_budget=max(0, args.time_budget), overrides=overrides,
    )
    report = result.pop("_report")
    atomic_json(OUTPUT_PATH, result)
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
