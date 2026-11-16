#!/usr/bin/env python3
"""Offline AniList next-episode schedule for public, verified catalogue identities.

Only provider IDs already verified by ``connections.verified_sources`` are
queried. Title search, Telegram post timestamps and guessed weekly cadence are
never used. The generated file is public metadata; rendering never fetches the
provider API.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import json
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

try:
    import connections
except ModuleNotFoundError:  # Loaded by tests from a different sys.path root.
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import connections

ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = ROOT / "src/lib/real-catalog.json"
METADATA_PATH = ROOT / "src/lib/generated-metadata.json"
OVERRIDES_PATH = ROOT / "src/lib/admin-public-overrides.json"
OUTPUT_PATH = ROOT / "src/lib/generated-airing.json"

API_URL = connections.API_URL
USER_AGENT = "AnimeVerse-AiringSchedule/1.0"
MAX_RESPONSE = 2 * 1024 * 1024
BATCH_SIZE = 50
MAX_ENTRIES = 1200
MAX_EPOCH = 4_102_444_800  # 2100-01-01 UTC; reject absurd source timestamps.
FRESH_SECONDS = 30 * 60
DEFAULT_MAX_REQUESTS = 10
DEFAULT_TIME_BUDGET = 120

STATUSES = {"RELEASING", "NOT_YET_RELEASED"}
FORMATS = {"TV", "TV_SHORT", "MOVIE", "SPECIAL", "OVA", "ONA", "MUSIC"}
BLOCKED_FORMATS = {"MOVIE", "OVA", "MUSIC"}
TYPE_FORMATS = {
    "فیلم": {"MOVIE"},
    "OVA": {"OVA"},
    "سریال": {"TV", "TV_SHORT", "ONA", "SPECIAL"},
}

QUERY = """query ($ids: [Int]) {
  Page(page: 1, perPage: 50) {
    media(id_in: $ids, type: ANIME) {
      id type status format startDate { year }
      nextAiringEpisode { airingAt episode }
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
    fd, name = tempfile.mkstemp(prefix=".airing-", dir=str(path.parent))
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


def iso_epoch(value: int) -> str:
    return dt.datetime.fromtimestamp(value, dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(value) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def valid_epoch(value) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > MAX_EPOCH:
        return None
    return value


def valid_episode(value) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


def next_episode(media, now: float) -> dict | None:
    """Only a real, future provider timestamp; never derive or extrapolate one."""
    node = media.get("nextAiringEpisode") if isinstance(media, dict) else None
    if not isinstance(node, dict):
        return None
    airing_at = valid_epoch(node.get("airingAt"))
    episode = valid_episode(node.get("episode"))
    if airing_at is None or episode is None or airing_at <= now:
        return None
    return {"episode": episode, "airingAt": iso_epoch(airing_at)}


def local_constraints(rows, metadata, hidden, sources) -> dict[int, list[dict]]:
    """Local format/type facts for each already verified provider identity."""
    result: dict[int, list[dict]] = {}
    for row in rows:
        slug = row.get("slug")
        if not isinstance(slug, str) or not slug or slug in hidden:
            continue
        metadata_id = connections.metadata_provider_id(row, (metadata or {}).get(slug))
        url_id = connections.metadata_url_provider_id(row)
        if metadata_id and url_id and metadata_id != url_id:
            continue
        provider_id = metadata_id or url_id
        if not provider_id or provider_id not in sources:
            continue
        snapshot = connections.identity_snapshot(row)
        if snapshot not in sources[provider_id]:
            continue
        result.setdefault(provider_id, []).append({
            "snapshot": snapshot,
            "format": str(row.get("format") or "").upper(),
            "type": str(row.get("type") or ""),
        })
    return result


def source_identity(media, provider_id: int, sources, constraints) -> dict | None:
    """Reject stale, contradictory or ambiguous identities before caching a date."""
    if not isinstance(media, dict) or media.get("type") != "ANIME":
        return None
    if connections.valid_id(media.get("id")) != provider_id:
        return None
    status = str(media.get("status") or "").upper()
    if status not in STATUSES:
        return None
    fmt = str(media.get("format") or "").upper()
    if fmt not in FORMATS or fmt in BLOCKED_FORMATS:
        return None
    start = media.get("startDate") or {}
    raw_year = start.get("year") if isinstance(start, dict) else None
    if raw_year is not None and connections.valid_year(raw_year) is None:
        return None
    provider_year = connections.valid_year(raw_year)
    source_years = {item.get("year") for item in sources if connections.valid_year(item.get("year"))}
    if provider_year and any(provider_year != year for year in source_years):
        return None
    if not sources or not constraints:
        return None
    for item in constraints:
        local_format = item.get("format") or ""
        if local_format and local_format != fmt:
            return None
        expected = TYPE_FORMATS.get(item.get("type") or "")
        if expected and fmt not in expected:
            return None
    return {
        "providerId": provider_id,
        "type": "ANIME",
        "status": status,
        "format": fmt,
        "year": provider_year or 0,
    }


def entry_from_media(media, provider_id: int, sources, constraints, checked_at: str, now: float) -> dict | None:
    identity = source_identity(media, provider_id, sources, constraints)
    upcoming = next_episode(media, now)
    if not identity or not upcoming:
        return None
    return {
        "sourceUrl": f"https://anilist.co/anime/{provider_id}",
        "checkedAt": checked_at,
        "identity": identity,
        "sources": sources,
        "nextAiringEpisode": upcoming,
    }


def entry_is_fresh(existing, provider_id: int, sources, now: float, ttl_seconds: float) -> bool:
    if not isinstance(existing, dict):
        return False
    identity = existing.get("identity") or {}
    if identity.get("providerId") != provider_id or identity.get("type") != "ANIME":
        return False
    if identity.get("status") not in STATUSES:
        return False
    if existing.get("sources") != sources:
        return False
    checked = parse_iso(existing.get("checkedAt"))
    if checked is None or checked > now or now - checked >= ttl_seconds:
        return False
    upcoming = existing.get("nextAiringEpisode") or {}
    airing_at = parse_iso(upcoming.get("airingAt"))
    return airing_at is not None and airing_at > now and valid_episode(upcoming.get("episode")) is not None


def fetch_batch(ids, blocked_until: float = 0, budget_end: float = 0) -> tuple[list[dict] | None, str, float]:
    """One request; persist rate deadlines for the next scheduled worker run."""
    payload = json.dumps({"query": QUERY, "variables": {"ids": list(ids)}}).encode()
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
        timeout = min(30, max(1, budget_end - now)) if budget_end else 30
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise ValueError("oversized-response")
        result = json.loads(raw)
        if result.get("errors"):
            raise ValueError("graphql-errors")
        media = ((result.get("data") or {}).get("Page") or {}).get("media") or []
        return media if isinstance(media, list) else [], "ok", 0
    except urllib.error.HTTPError as error:
        if error.code == 429:
            wait = connections.retry_after_seconds((error.headers or {}).get("Retry-After"))
            return None, "rate-limited", time.time() + (wait if wait is not None else 60)
        return None, f"http-{error.code}", blocked_until
    except (OSError, ValueError) as error:
        return None, type(error).__name__, blocked_until


def _enrich_locked(rows, root: Path, metadata, overrides, old, *, limit, refresh,
                   ttl_seconds, max_requests, time_budget, now) -> dict:
    hidden = connections.hidden_slugs(overrides)
    sources = connections.verified_sources(rows, metadata, hidden)
    constraints = local_constraints(rows, metadata, hidden, sources)

    old_entries = old.get("entries") if isinstance(old, dict) else {}
    old_entries = old_entries if isinstance(old_entries, dict) else {}
    source_keys = {str(item) for item in sources}
    entries = {
        str(key): value for key, value in old_entries.items()
        if str(key).isdigit() and str(int(key)) in source_keys
    }

    todo = [
        provider_id for provider_id, snapshots in sources.items()
        if refresh or not entry_is_fresh(entries.get(str(provider_id)), provider_id, snapshots,
                                         now, ttl_seconds)
    ]
    cached_ids = {int(key) for key in entries}
    todo.sort(key=lambda value: (value in cached_ids, value))

    provider_state = (old.get("providerState") if isinstance(old, dict) else {}) or {}
    blocked_until = float(provider_state.get("blockedUntil") or 0)
    checked_at = iso_now(now)
    attempted = fetched = rejected = failed = request_count = 0
    status = "ok"
    budget_end = now + max(0, time_budget)
    missing = []

    if blocked_until > now:
        status = "rate-limited"
    else:
        for start in range(0, min(len(todo), limit), BATCH_SIZE):
            batch = todo[start:min(start + BATCH_SIZE, limit)]
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
                media_node = returned.get(provider_id)
                if not media_node:
                    missing.append(provider_id)
                    entries.pop(str(provider_id), None)
                    continue
                entry = entry_from_media(media_node, provider_id, sources[provider_id],
                                         constraints.get(provider_id, []), checked_at, now)
                if not entry:
                    rejected += 1
                    entries.pop(str(provider_id), None)
                    continue
                entries[str(provider_id)] = entry
                fetched += 1
            if time.time() >= budget_end:
                status = "partial"
                break
            if start + BATCH_SIZE < min(len(todo), limit):
                time.sleep(1.5)

    entries = {key: entries[key] for key in sorted(entries, key=lambda value: int(value))
               if key in source_keys}
    if len(entries) > MAX_ENTRIES:
        entries = {key: entries[key] for key in list(entries)[:MAX_ENTRIES]}
        status = "bounded"

    latest = max((entry.get("checkedAt") for entry in entries.values() if entry.get("checkedAt")),
                 default=None)
    provider_state = {"blockedUntil": int(blocked_until) if blocked_until > now else 0}
    if provider_state["blockedUntil"]:
        provider_state["reason"] = "HTTP 429 Retry-After"

    result = {
        "version": 1,
        "provider": "anilist",
        "checkedAt": latest,
        "status": status,
        "coverage": {"verifiedLocalIds": len(sources), "cachedIds": len(entries)},
        "providerState": provider_state,
        "entries": entries,
    }
    result["_report"] = {
        "verified": len(sources), "upcoming": len(entries), "todo": len(todo),
        "attempted": attempted, "fetched": fetched, "rejected": rejected,
        "failed": failed, "missing": missing, "requests": request_count,
        "status": status, "busy": False,
    }
    return result


def enrich(rows, root=ROOT, *, metadata=None, overrides=None, old=None,
           limit=MAX_ENTRIES, refresh=False, ttl_seconds=FRESH_SECONDS,
           max_requests=DEFAULT_MAX_REQUESTS, time_budget=DEFAULT_TIME_BUDGET,
           now=None) -> dict:
    """Public worker hook. Acquires the shared non-blocking artwork lock."""
    root = Path(root)
    now = time.time() if now is None else now
    if limit <= 0 or not rows:
        return {"attempted": 0, "fetched": 0, "busy": False, "status": "ok",
                "verified": 0, "upcoming": 0}

    data = root / "data"
    data.mkdir(parents=True, exist_ok=True)
    with (data / "artwork.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"attempted": 0, "fetched": 0, "busy": True, "status": "busy",
                    "verified": 0, "upcoming": 0}

        metadata = metadata if metadata is not None else (
            read_json(root / "src/lib/generated-metadata.json", {}) or {}).get("metadata", {})
        overrides = overrides if overrides is not None else read_json(
            root / "src/lib/admin-public-overrides.json", {})
        output_path = root / "src/lib/generated-airing.json"
        old_value = old if old is not None else read_json(
            output_path, {"version": 1, "entries": {}})
        result = _enrich_locked(
            rows, root, metadata or {}, overrides or {}, old_value or {},
            limit=max(0, min(limit, MAX_ENTRIES)), refresh=refresh,
            ttl_seconds=max(0, ttl_seconds), max_requests=max(0, max_requests),
            time_budget=max(0, time_budget), now=now,
        )
        report = result.pop("_report")
        if result != old_value:
            atomic_json(output_path, result)
        return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=MAX_ENTRIES, help="Maximum verified IDs")
    parser.add_argument("--force", action="store_true", help="Ignore the 30-minute freshness cooldown")
    parser.add_argument("--ttl-minutes", type=float, default=FRESH_SECONDS / 60)
    parser.add_argument("--max-requests", type=int, default=DEFAULT_MAX_REQUESTS)
    parser.add_argument("--time-budget", type=float, default=DEFAULT_TIME_BUDGET)
    args = parser.parse_args()

    rows = read_json(CATALOG_PATH, [])
    report = enrich(
        rows if isinstance(rows, list) else [], ROOT,
        limit=max(0, min(args.limit, MAX_ENTRIES)), refresh=args.force,
        ttl_seconds=max(0, args.ttl_minutes) * 60,
        max_requests=max(0, args.max_requests), time_budget=max(0, args.time_budget),
    )
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
