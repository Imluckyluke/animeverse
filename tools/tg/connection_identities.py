#!/usr/bin/env python3
"""Offline, exact-title identity bindings for public anime relation pages.

The public catalogue contains pages whose AniList provider ID is not present in
``generated-metadata.json`` and whose ``metadataUrl`` is empty.  This worker
binds such a page only when one canonical AniList title aliases the local title
exactly (normalized case/punctuation, never stripped season/part/roman
markers), the known year and format agree, and exactly one provider ID remains.

Bindings are stored as an exact snapshot of the public local identity, so a
changed title/year/format invalidates the binding at render time.  Unknown-year
local rows additionally require a full, fresh provider entry and a
season/part/cour-specific title.  Generic base titles and fuzzy prefixes never
bind.

The same worker maintains a bounded graph-support cache: only explicit
anime-to-anime PREQUEL/SEQUEL nodes that bridge two verified local pages are
kept.  No title search is used for graph expansion, no render-time network call
exists, and all writes happen behind the shared non-blocking artwork lock.
"""
from __future__ import annotations

import argparse
import collections
import contextlib
import fcntl
import hashlib
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

try:
    import connections
except ModuleNotFoundError:  # Loaded by tests from a different sys.path root.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import connections

ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = ROOT / "src/lib/real-catalog.json"
METADATA_PATH = ROOT / "src/lib/generated-metadata.json"
OVERRIDES_PATH = ROOT / "src/lib/admin-public-overrides.json"
CONNECTIONS_PATH = ROOT / "src/lib/generated-connections.json"
IDENTITIES_PATH = ROOT / "src/lib/generated-connection-identities.json"

BATCH_SIZE = 50
MAX_RESPONSE = 8 * 1024 * 1024
MAX_BINDINGS = 800
MAX_SUPPORT_ENTRIES = 360
MAX_SUPPORT_FETCH = 240
MAX_BRIDGE_DEPTH = 6
DEFAULT_MAX_REQUESTS = 24
DEFAULT_TIME_BUDGET = 150
FRESH_TTL_SECONDS = 14 * 24 * 3600

FORMATS = {"TV", "TV_SHORT", "MOVIE", "SPECIAL", "OVA", "ONA", "MUSIC"}
TYPE_FORMATS = {"فیلم": "MOVIE", "OVA": "OVA"}
GRAPH_RELATIONS = {"PREQUEL", "SEQUEL"}

# Only markers already present in a canonical title are recognised.  Nothing is
# removed from the title before comparison.
SEASON_MARKER = re.compile(
    r"""(?ix)
    \b(?:the\s+)?(?:final\s+)?season\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|final)?\b
    | \b(?:part|cour|chapter)\s*(?:\d+|one|two|three|four|five|six|final)\b
    | \b\d+(?:st|nd|rd|th)\b
    | \b(?:ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv)\b
    | 第\s*[0-9一二三四五六七八九十百]+\s*[期季部]
    | [0-9]+\s*(?:期|クール)
    | \b(?:zenpen|kouhen|first\s+cour|second\s+cour|third\s+cour)\b
    """
)
PUNCTUATION = re.compile(r"[^\w\u3040-\u30ff\u3400-\u9fff\u3400-\u9fff\uac00-\ud7af\u0600-\u06ff]+")


def read_json(path: Path, default):
    return connections.read_json(path, default)


def atomic_json(path: Path, value) -> None:
    connections.atomic_json(path, value)


def normalize_title(value) -> str:
    """Case/punctuation-normalized full title; all words and markers survive."""
    text = unicodedata.normalize("NFKC", str(value or "")).casefold()
    text = text.replace("&", " and ").replace("_", " ")
    text = re.sub(r"[’‘`´]", "'", text)
    text = re.sub(r"[‐‑‒–—−]", "-", text)
    text = PUNCTUATION.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def has_season_marker(value) -> bool:
    return bool(SEASON_MARKER.search(str(value or "")))


def _node_from_identity(identity) -> dict | None:
    if not isinstance(identity, dict) or identity.get("type") != "ANIME":
        return None
    provider_id = connections.valid_id(identity.get("id"))
    if not provider_id or not isinstance(identity.get("titleEn"), str):
        return None
    return {
        "id": provider_id,
        "type": "ANIME",
        "titleEn": identity.get("titleEn") or "",
        "titleJa": identity.get("titleJa") or "",
        "titleRomaji": identity.get("titleRomaji") or "",
        "year": connections.valid_year(identity.get("year")),
        "format": identity.get("format") if identity.get("format") in FORMATS else "",
        "cover": identity.get("cover") or "",
    }


def _node_from_edge_node(node) -> dict | None:
    if not isinstance(node, dict) or node.get("type") != "ANIME":
        return None
    provider_id = connections.valid_id(node.get("id"))
    if not provider_id or not isinstance(node.get("titleEn"), str):
        return None
    return {
        "id": provider_id,
        "type": "ANIME",
        "titleEn": node.get("titleEn") or "",
        "titleJa": node.get("titleJa") or "",
        "titleRomaji": node.get("titleRomaji") or "",
        "year": connections.valid_year(node.get("year")),
        "format": node.get("format") if node.get("format") in FORMATS else "",
        "cover": node.get("cover") or "",
    }


def build_node_index(document) -> dict[int, dict]:
    """Canonical node facts, preferring a full cache entry over a relation stub."""
    entries = (document or {}).get("entries") or {}
    index: dict[int, dict] = {}
    if not isinstance(entries, dict):
        return index
    for key, entry in entries.items():
        if not isinstance(entry, dict):
            continue
        identity = entry.get("identity") or {}
        node = _node_from_identity(identity)
        provider_id = connections.valid_id(identity.get("providerId"))
        if node and provider_id == node["id"]:
            index[node["id"]] = {
                "node": node,
                "fromEntry": True,
                "checkedAt": entry.get("checkedAt"),
                "support": entry.get("support") is True,
            }
        for edge in entry.get("relations") or []:
            if not isinstance(edge, dict):
                continue
            target = _node_from_edge_node(edge.get("node"))
            if target and target["id"] not in index:
                index[target["id"]] = {
                    "node": target, "fromEntry": False, "checkedAt": None, "support": False,
                }
        for recommendation in entry.get("recommendations") or []:
            target = _node_from_edge_node(recommendation)
            if target and target["id"] not in index:
                index[target["id"]] = {
                    "node": target, "fromEntry": False, "checkedAt": None, "support": False,
                }
    return index


def node_aliases(node) -> list[tuple[str, str, str]]:
    aliases = []
    seen = set()
    for field in ("titleEn", "titleRomaji", "titleJa"):
        raw = str((node or {}).get(field) or "").strip()
        normalized = normalize_title(raw)
        if normalized and normalized not in seen:
            seen.add(normalized)
            aliases.append((field, raw, normalized))
    return aliases


def build_alias_index(node_index) -> dict[str, set[int]]:
    index: dict[str, set[int]] = {}
    for provider_id, fact in node_index.items():
        for _, _, normalized in node_aliases(fact["node"]):
            index.setdefault(normalized, set()).add(provider_id)
    return index


def local_format(row) -> str:
    raw = str(row.get("format") or "").upper()
    if raw in FORMATS:
        return raw
    return TYPE_FORMATS.get(str(row.get("type") or ""), "")


def _year_compatible(row, node) -> bool:
    local_year = connections.valid_year(row.get("year")) or 0
    provider_year = connections.valid_year((node or {}).get("year")) or 0
    return not (local_year and provider_year) or local_year == provider_year


def _format_compatible(row, node) -> bool:
    local = local_format(row)
    provider = (node or {}).get("format") or ""
    if provider not in FORMATS or (local and local != provider):
        return False
    expected = {"سریال": {"TV", "TV_SHORT", "ONA"}, "فیلم": {"MOVIE"}, "OVA": {"OVA", "SPECIAL"}}.get(row.get("type"))
    return bool(local) or not expected or provider in expected


def _fresh_provider_ids(document, now: float, ttl_seconds: float = FRESH_TTL_SECONDS) -> set[int]:
    fresh = set()
    entries = (document or {}).get("entries") or {}
    if not isinstance(entries, dict):
        return fresh
    for key, entry in entries.items():
        if not isinstance(entry, dict):
            continue
        identity = entry.get("identity") or {}
        provider_id = connections.valid_id(identity.get("providerId"))
        if not provider_id or _node_from_identity(identity) is None:
            continue
        checked = connections.parse_iso(entry.get("checkedAt"))
        if checked is not None and 0 <= now - checked < ttl_seconds:
            fresh.add(provider_id)
    return fresh


def _untruncated(fact) -> bool:
    node = (fact or {}).get("node") or {}
    return bool(node.get("titleEn")) and len(node_aliases(node)) >= 2


def match_identity(row, node_index, alias_index, fresh_ids=frozenset(),
                   *, enforce_fresh=True) -> tuple[dict | None, str]:
    """Return one exact full-title provider match or a fail-closed reason."""
    title_en = str(row.get("titleEn") or "").strip()
    title_ja = str(row.get("titleJa") or "").strip()
    primary = normalize_title(title_en)
    secondary = normalize_title(title_ja)
    en_marker = has_season_marker(title_en)
    ja_marker = has_season_marker(title_ja)
    used_field, matched_title, normalized = "titleEn", title_en, primary
    candidates = set(alias_index.get(primary, set())) if primary else set()

    # Prefer the title that actually carries a season/part marker.  A generic
    # English or native base title must not silently select a different season.
    if ja_marker and not en_marker:
        used_field, matched_title, normalized = "titleJa", title_ja, secondary
        candidates = set(alias_index.get(secondary, set())) if secondary else set()
        if not candidates:
            return None, "season-title-unmatched"
    elif not candidates:
        if en_marker:
            return None, "title-en-unmatched"
        if secondary and secondary != primary:
            candidates = set(alias_index.get(secondary, set()))
            used_field, matched_title, normalized = "titleJa", title_ja, secondary

    if not candidates:
        return None, "no-exact-title"

    local_year = connections.valid_year(row.get("year")) or 0
    season_specific = has_season_marker(title_en) or has_season_marker(title_ja)
    compatible = []
    reasons = []
    for provider_id in sorted(candidates):
        fact = node_index.get(provider_id)
        if not fact:
            continue
        node = fact["node"]
        node_norms = {item[2] for item in node_aliases(node)}
        if normalized not in node_norms:
            continue
        if not _year_compatible(row, node):
            reasons.append("year-conflict")
            continue
        if not _format_compatible(row, node):
            reasons.append("format-conflict")
            continue
        if not local_year:
            if not season_specific:
                reasons.append("unknown-year-generic")
                continue
            if enforce_fresh and (provider_id not in fresh_ids or not fact.get("fromEntry")):
                reasons.append("unknown-year-unfresh")
                continue
            if enforce_fresh and not _untruncated(fact):
                reasons.append("unknown-year-truncated")
                continue
        compatible.append(provider_id)

    if not compatible:
        return None, reasons[0] if reasons else "no-compatible-title"
    if len(compatible) != 1:
        return None, "ambiguous-provider"

    provider_id = compatible[0]
    fact = node_index[provider_id]
    node = fact["node"]
    canonical = next((raw for field, raw, norm in node_aliases(node)
                      if norm == normalized), "")
    alias_matches = sum(
        1 for _, _, norm in node_aliases(node)
        if norm in {normalize_title(title_en), normalize_title(title_ja)}
    )
    evidence = {
        "method": "exact-full-title",
        "matchedField": used_field,
        "matchedTitle": matched_title,
        "canonicalTitle": canonical,
        "aliasMatches": alias_matches,
        "knownYear": bool(local_year),
        "seasonSpecific": season_specific,
        "providerYear": node.get("year"),
        "providerFormat": node.get("format") or "",
        "fresh": provider_id in fresh_ids,
        "fromEntry": bool(fact.get("fromEntry")),
        "checkedAt": fact.get("checkedAt"),
    }
    return {
        "providerId": provider_id,
        "node": node,
        "evidence": evidence,
        "reason": "ok",
    }, "ok"


def _explicit_provider(row, metadata) -> tuple[int | None, bool]:
    entry = (metadata or {}).get(row.get("slug"))
    metadata_id = connections.metadata_provider_id(row, entry)
    url_id = connections.metadata_url_provider_id(row)
    if metadata_id and url_id and metadata_id != url_id:
        return None, True
    return metadata_id or url_id, False


def match_catalogue(rows, metadata, document, overrides=None,
                    fresh_ids=frozenset(), *, enforce_fresh=True) -> list[dict]:
    hidden = connections.hidden_slugs(overrides)
    node_index = build_node_index(document)
    alias_index = build_alias_index(node_index)
    results = []
    for row in rows:
        slug = row.get("slug")
        if not isinstance(slug, str) or not slug or slug in hidden:
            continue
        explicit, conflict = _explicit_provider(row, metadata)
        if conflict:
            results.append({"row": row, "explicit": None, "conflict": True,
                            "match": None, "reason": "conflicting-explicit-ids"})
            continue
        if explicit:
            results.append({"row": row, "explicit": explicit, "conflict": False,
                            "match": None, "reason": "explicit-binding"})
            continue
        match, reason = match_identity(
            row, node_index, alias_index, fresh_ids, enforce_fresh=enforce_fresh)
        results.append({"row": row, "explicit": None, "conflict": False,
                        "match": match, "reason": reason})
    return results


def build_bindings(results, *, max_bindings=MAX_BINDINGS) -> tuple[dict, dict]:
    """Resolve duplicate local/provider conflicts, then build the public map."""
    explicit_ids = {item["explicit"] for item in results if item["explicit"]}
    candidates = collections.defaultdict(list)
    for item in results:
        if item["explicit"]:
            continue
        match = item["match"]
        if match:
            candidates[match["providerId"]].append(item)

    bindings = {}
    unresolved = collections.Counter()
    for provider_id, items in sorted(candidates.items()):
        if provider_id in explicit_ids or len({item["row"]["slug"] for item in items}) != 1:
            unresolved["duplicate-local-provider"] += len(items)
            continue
        item = items[0]
        row = item["row"]
        if len(bindings) >= max_bindings:
            unresolved["binding-limit"] += 1
            break
        bindings[row["slug"]] = {
            "identity": {
                "titleEn": str(row.get("titleEn") or ""),
                "titleJa": str(row.get("titleJa") or ""),
                "year": connections.valid_year(row.get("year")) or 0,
                "format": str(row.get("format") or ""),
                "type": str(row.get("type") or ""),
            },
            "providerId": provider_id,
            "evidence": item["match"]["evidence"],
        }
    for item in results:
        if item["explicit"] or item["match"]:
            continue
        unresolved[item["reason"]] += 1
    return bindings, dict(unresolved)


def binding_sources(rows, bindings) -> dict[int, list[dict]]:
    rows_by_slug = {row.get("slug"): row for row in rows if isinstance(row.get("slug"), str)}
    sources: dict[int, list[dict]] = collections.defaultdict(list)
    for slug, binding in bindings.items():
        row = rows_by_slug.get(slug)
        if not row:
            continue
        snapshot = connections.identity_snapshot(row)
        if snapshot not in sources[binding["providerId"]]:
            sources[binding["providerId"]].append(snapshot)
    for bucket in sources.values():
        bucket.sort(key=lambda item: (item["titleEn"], item["titleJa"], item["year"]))
    return dict(sources)


def merge_sources(explicit_sources, identity_sources) -> dict[int, list[dict]]:
    merged = {provider_id: list(items) for provider_id, items in explicit_sources.items()}
    for provider_id, items in identity_sources.items():
        bucket = merged.setdefault(provider_id, [])
        for item in items:
            if item not in bucket:
                bucket.append(item)
        bucket.sort(key=lambda value: (value["titleEn"], value["titleJa"], value["year"]))
    return merged


def _relations(entry) -> list[dict]:
    return entry.get("relations") if isinstance(entry, dict) and isinstance(entry.get("relations"), list) else []


def _external_graph_targets(entries, entry_ids) -> collections.Counter:
    counts = collections.Counter()
    for provider_id in entry_ids:
        entry = entries.get(str(provider_id))
        for edge in _relations(entry):
            if not isinstance(edge, dict):
                continue
            if str(edge.get("relationType") or "") not in GRAPH_RELATIONS:
                continue
            node = edge.get("node") or {}
            target = connections.valid_id(node.get("id"))
            if not target or node.get("type") != "ANIME" or target == provider_id:
                continue
            counts[target] += 1
    return counts


def bridge_support_ids(local_ids, entries) -> set[int]:
    """Support nodes that actually sit on a PREQUEL/SEQUEL path between locals."""
    local = set(local_ids)
    support = set()
    for start in sorted(local):
        queue = collections.deque([(start, 0, ())])
        seen = {start}
        while queue:
            provider_id, depth, path = queue.popleft()
            if depth >= MAX_BRIDGE_DEPTH:
                continue
            entry = entries.get(str(provider_id))
            for edge in _relations(entry):
                if not isinstance(edge, dict):
                    continue
                if str(edge.get("relationType") or "") not in GRAPH_RELATIONS:
                    continue
                node = edge.get("node") or {}
                target = connections.valid_id(node.get("id"))
                if not target or node.get("type") != "ANIME" or target in seen:
                    continue
                seen.add(target)
                if target in local:
                    support.update(item for item in path if item not in local)
                    continue
                if str(target) in entries:
                    queue.append((target, depth + 1, path + (target,)))
    return support


def _support_entry(media, checked_at: str) -> dict | None:
    entry = connections.cache_entry(media, [], checked_at)
    if not entry:
        return None
    entry["support"] = True
    entry["recommendations"] = []
    return entry


def refresh_connection_data(rows, root=ROOT, *, metadata=None, overrides=None,
                            old_connections=None, old_identities=None,
                            max_requests=DEFAULT_MAX_REQUESTS,
                            time_budget=DEFAULT_TIME_BUDGET,
                            refresh=False, now=None) -> dict:
    """Public worker hook.  Acquires the shared non-blocking artwork lock."""
    root = Path(root)
    now = time.time() if now is None else now
    if not rows:
        return {"status": "ok", "attempted": 0, "fetched": 0, "busy": False}
    data = root / "data"
    data.mkdir(parents=True, exist_ok=True)
    metadata = metadata if metadata is not None else (read_json(root / "src/lib/generated-metadata.json", {}) or {}).get("metadata", {})
    overrides = overrides if overrides is not None else read_json(root / "src/lib/admin-public-overrides.json", {})
    old_identities = old_identities if old_identities is not None else read_json(root / "src/lib/generated-connection-identities.json", {})
    identity_keys = ("slug", "titleEn", "titleJa", "year", "format", "type", "metadataSource", "metadataUrl")
    digest = hashlib.sha256(json.dumps({
        "rows": [{key: row.get(key) for key in identity_keys} for row in sorted(rows, key=lambda row: row.get("slug") or "")],
        "metadata": metadata, "overrides": (overrides or {}).get("overrides", {}),
    }, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    checked = connections.parse_iso(old_identities.get("lastRefreshAt"))
    if not refresh and old_identities.get("inputDigest") == digest and checked is not None and 0 <= now - checked < 86400:
        return {"status": "fresh", "busy": False, "attempted": 0, "fetched": 0}
    with (data / "artwork.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "busy", "busy": True, "attempted": 0, "fetched": 0}
        report = _refresh_locked(
            rows, root, metadata=metadata, overrides=overrides,
            old_connections=old_connections, old_identities=old_identities,
            max_requests=max_requests, time_budget=time_budget,
            refresh=refresh, now=now,
        )
        if report.get("status") in {"ok", "bounded"}:
            path = root / "src/lib/generated-connection-identities.json"
            saved = read_json(path, {})
            saved.update(inputDigest=digest, lastRefreshAt=connections.iso_now(now))
            atomic_json(path, saved)
        return report


def _refresh_locked(rows, root, *, metadata, overrides, old_connections,
                    old_identities, max_requests, time_budget, refresh, now) -> dict:
    root = Path(root)
    metadata = metadata if metadata is not None else (
        read_json(root / "src/lib/generated-metadata.json", {}) or {}).get("metadata", {})
    overrides = overrides if overrides is not None else read_json(
        root / "src/lib/admin-public-overrides.json", {})
    old_connections = old_connections if old_connections is not None else read_json(
        root / "src/lib/generated-connections.json", {"version": 1, "entries": {}})
    old_identities = old_identities if old_identities is not None else read_json(
        root / "src/lib/generated-connection-identities.json", {"version": 1, "bindings": {}})
    old_connections = old_connections if isinstance(old_connections, dict) else {}
    old_identities = old_identities if isinstance(old_identities, dict) else {}
    old_entries = old_connections.get("entries") if isinstance(old_connections.get("entries"), dict) else {}

    hidden = connections.hidden_slugs(overrides)
    explicit_sources = connections.verified_sources(rows, metadata, hidden)
    checked_at = connections.iso_now(now)
    fresh_existing = _fresh_provider_ids(old_connections, now)
    provisional = match_catalogue(
        rows, metadata, old_connections, overrides, fresh_existing, enforce_fresh=False)
    provisional_bindings, _ = build_bindings(provisional)
    tentative_ids = {binding["providerId"] for binding in provisional_bindings.values()}
    tentative_ids.update(item["explicit"] for item in provisional if item["explicit"])
    tentative_ids.update(explicit_sources)

    provider_state = old_connections.get("providerState") if isinstance(old_connections, dict) else {}
    blocked_until = float((provider_state or {}).get("blockedUntil") or 0)
    budget_end = now + max(0, time_budget)
    request_count = attempted = fetched = failed = 0
    missing = []
    status = "ok"
    media: dict[int, dict] = {}

    def fetch(ids):
        nonlocal request_count, attempted, fetched, failed, status, blocked_until
        pending = [provider_id for provider_id in ids if provider_id not in media]
        for start in range(0, len(pending), BATCH_SIZE):
            batch = pending[start:start + BATCH_SIZE]
            if request_count >= max_requests:
                status = "partial"
                return
            if time.time() >= budget_end:
                status = "partial"
                return
            if blocked_until > time.time():
                status = "rate-limited"
                return
            nodes, error, blocked_until = connections.fetch_batch(batch, blocked_until, budget_end)
            request_count += 1
            attempted += len(batch)
            if nodes is None:
                failed += len(batch)
                status = "rate-limited" if error == "rate-limited" else "partial"
                return
            returned = {item.get("id"): item for item in nodes if isinstance(item, dict)}
            for provider_id in batch:
                node = returned.get(provider_id)
                if not node:
                    missing.append(provider_id)
                    continue
                media[provider_id] = node
                fetched += 1
            if start + BATCH_SIZE < len(pending):
                time.sleep(1.5)

    todo = sorted(provider_id for provider_id in tentative_ids
                  if refresh or provider_id not in fresh_existing)
    if blocked_until > time.time():
        status = "rate-limited"
    else:
        fetch(todo)

    matching_entries = {key: value for key, value in old_entries.items()
                        if str(key).isdigit() and isinstance(value, dict)
                        and not connections.is_support_entry(value)}
    for provider_id, node in media.items():
        entry = connections.cache_entry(node, [], checked_at)
        if entry and entry["identity"]["providerId"] == provider_id:
            matching_entries[str(provider_id)] = entry

    # A fetched entry can expose new canonical relation nodes.  Resolve those
    # exact titles in bounded extra passes instead of stopping at stale graph
    # coverage.
    final_results = []
    bindings = {}
    unresolved = {}
    identity_sources = {}
    source_map = {}
    for _ in range(3):
        matching_doc = {"entries": matching_entries}
        fresh_ids = _fresh_provider_ids(matching_doc, now) | set(media)
        final_results = match_catalogue(
            rows, metadata, matching_doc, overrides, fresh_ids, enforce_fresh=True)
        bindings, unresolved = build_bindings(final_results)
        identity_sources = binding_sources(rows, bindings)
        source_map = merge_sources(explicit_sources, identity_sources)
        missing_bound = sorted(provider_id for provider_id in source_map
                               if provider_id not in media and provider_id not in fresh_existing
                               and str(provider_id) not in matching_entries)
        if not missing_bound or request_count >= max_requests or time.time() >= budget_end:
            break
        before = set(media)
        fetch(missing_bound)
        if set(media) == before:
            break
        for provider_id in sorted(set(media) - before):
            entry = connections.cache_entry(media[provider_id], [], checked_at)
            if entry and entry["identity"]["providerId"] == provider_id:
                matching_entries[str(provider_id)] = entry

    final_results = match_catalogue(
        rows, metadata, {"entries": matching_entries}, overrides,
        _fresh_provider_ids({"entries": matching_entries}, now) | set(media),
        enforce_fresh=True)
    bindings, unresolved = build_bindings(final_results)
    identity_sources = binding_sources(rows, bindings)
    source_map = merge_sources(explicit_sources, identity_sources)
    local_ids = set(source_map)
    entries: dict[str, dict] = {}
    for provider_id in sorted(source_map):
        node = media.get(provider_id)
        entry = None
        if node:
            entry = connections.cache_entry(node, source_map[provider_id], checked_at)
        if not entry:
            existing = old_entries.get(str(provider_id))
            if (isinstance(existing, dict)
                    and (existing.get("identity") or {}).get("providerId") == provider_id):
                entry = dict(existing)
                entry.pop("support", None)
                entry["sources"] = source_map[provider_id]
                if not isinstance(entry.get("recommendations"), list):
                    entry["recommendations"] = []
        if entry and entry["identity"]["providerId"] == provider_id:
            entries[str(provider_id)] = entry

    old_support = {str(provider_id): entry for provider_id, entry in old_entries.items()
                   if str(provider_id).isdigit() and connections.is_support_entry(entry)
                   and int(provider_id) not in local_ids}
    all_entries = {**old_support, **entries}
    support_fetched = set()
    fetched_support = set()
    for _ in range(2):
        candidates = _external_graph_targets(
            all_entries, [*local_ids, *fetched_support])
        pending = [provider_id for provider_id, _count in candidates.most_common(MAX_SUPPORT_FETCH)
                   if provider_id not in local_ids and str(provider_id) not in all_entries]
        pending = pending[:max(0, MAX_SUPPORT_FETCH - len(support_fetched))]
        if not pending:
            break
        before = set(media)
        fetch(pending)
        added = set(media) - before
        if not added:
            break
        for provider_id in sorted(added):
            entry = _support_entry(media[provider_id], checked_at)
            if entry:
                all_entries[str(provider_id)] = entry
                support_fetched.add(provider_id)
                fetched_support.add(provider_id)

    # Support entries are already full provider snapshots.  If one exactly
    # identifies a local row, promote it in the same run instead of waiting for
    # a later worker pass.
    for _ in range(2):
        promoted_doc = {"entries": {**matching_entries, **all_entries}}
        promoted_fresh = _fresh_provider_ids(promoted_doc, now) | set(media)
        promoted_results = match_catalogue(
            rows, metadata, promoted_doc, overrides, promoted_fresh, enforce_fresh=True)
        promoted_bindings, promoted_unresolved = build_bindings(promoted_results)
        promoted_sources = merge_sources(explicit_sources, binding_sources(rows, promoted_bindings))
        missing_promoted = sorted(provider_id for provider_id in promoted_sources
                                  if str(provider_id) not in all_entries
                                  and provider_id not in media
                                  and provider_id not in fresh_existing)
        if missing_promoted and request_count < max_requests and time.time() < budget_end:
            before = set(media)
            fetch(missing_promoted)
            if set(media) != before:
                for provider_id in sorted(set(media) - before):
                    entry = connections.cache_entry(media[provider_id], [], checked_at)
                    if entry and entry["identity"]["providerId"] == provider_id:
                        matching_entries[str(provider_id)] = entry
                        all_entries[str(provider_id)] = entry
                continue
        final_results = promoted_results
        bindings = promoted_bindings
        unresolved = promoted_unresolved
        identity_sources = binding_sources(rows, bindings)
        source_map = promoted_sources
        local_ids = set(source_map)
        for provider_id in sorted(local_ids):
            existing = all_entries.get(str(provider_id))
            if not isinstance(existing, dict) or not connections.is_support_entry(existing):
                continue
            promoted = dict(existing)
            promoted.pop("support", None)
            promoted["sources"] = source_map[provider_id]
            entries[str(provider_id)] = promoted
            all_entries[str(provider_id)] = promoted
        break

    bridge_ids = bridge_support_ids(local_ids, all_entries)
    support_entries = {}
    keep_partial = status in {"partial", "rate-limited"}
    for key, entry in sorted(all_entries.items(), key=lambda item: int(item[0])):
        if int(key) in local_ids:
            continue
        if int(key) in bridge_ids or (keep_partial and int(key) in {int(item) for item in old_support}):
            support_entries[key] = entry
    if len(support_entries) > MAX_SUPPORT_ENTRIES:
        support_entries = dict(sorted(support_entries.items(), key=lambda item: int(item[0]))[:MAX_SUPPORT_ENTRIES])
        status = "bounded"
    entries.update(support_entries)
    entries = {key: entries[key] for key in sorted(entries, key=lambda value: int(value))}

    latest = max((entry.get("checkedAt") for entry in entries.values() if entry.get("checkedAt")), default=None)
    provider_state = {"blockedUntil": int(blocked_until) if blocked_until > time.time() else 0}
    if provider_state["blockedUntil"]:
        provider_state["reason"] = "HTTP 429 Retry-After"
    connections_doc = {
        "version": 1,
        "provider": "anilist",
        "checkedAt": latest,
        "status": status,
        "coverage": {
            "verifiedLocalIds": len(source_map),
            "cachedIds": len([key for key in entries if int(key) in source_map]),
            "supportIds": len([key for key in entries if int(key) not in source_map]),
        },
        "providerState": provider_state,
        "entries": entries,
    }

    old_bindings = old_identities.get("bindings") if isinstance(old_identities.get("bindings"), dict) else {}
    generated_at = checked_at
    if old_bindings == bindings and old_identities.get("generatedAt"):
        generated_at = old_identities.get("generatedAt")
    identities_doc = {
        "version": 1,
        "provider": "anilist",
        "generatedAt": generated_at,
        "coverage": {
            "catalogRows": len(rows),
            "explicitRows": sum(1 for item in final_results if item["explicit"]),
            "identityBindings": len(bindings),
            "boundProviderIds": len(source_map),
            "supportIds": len(support_entries),
        },
        "bindings": bindings,
    }

    old_connections_value = old_connections
    if connections_doc != old_connections_value:
        atomic_json(root / "src/lib/generated-connections.json", connections_doc)
    if identities_doc != old_identities:
        atomic_json(root / "src/lib/generated-connection-identities.json", identities_doc)

    unresolved_items = [item for item in final_results
                        if not item["explicit"] and not item["match"]]
    duplicate_reasons = {"duplicate-local-provider", "binding-limit"}
    reason_counts = collections.Counter(
        {key: value for key, value in unresolved.items() if key in duplicate_reasons})
    for item in unresolved_items:
        reason_counts[item["reason"]] += 1
    unresolved_rows = len(unresolved_items) + sum(
        value for key, value in unresolved.items() if key in duplicate_reasons)
    samples = [{"slug": item["row"].get("slug"), "reason": item["reason"]}
               for item in unresolved_items][:25]
    return {
        "status": status,
        "busy": False,
        "requests": request_count,
        "attempted": attempted,
        "fetched": fetched,
        "failed": failed,
        "missing": missing,
        "catalogRows": len(rows),
        "hiddenRows": len(hidden),
        "explicitRows": sum(1 for item in final_results if item["explicit"]),
        "explicitProviderIds": len(explicit_sources),
        "identityBindings": len(bindings),
        "boundProviderIds": len(source_map),
        "localEntries": len([key for key in entries if int(key) in source_map]),
        "supportIds": len(support_entries),
        "unresolvedRows": unresolved_rows,
        "unresolvedReasons": dict(reason_counts),
        "unresolvedSamples": samples,
        "blockedUntil": provider_state.get("blockedUntil", 0),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-requests", type=int, default=DEFAULT_MAX_REQUESTS)
    parser.add_argument("--time-budget", type=float, default=DEFAULT_TIME_BUDGET)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    rows = read_json(CATALOG_PATH, [])
    report = refresh_connection_data(
        rows if isinstance(rows, list) else [], ROOT,
        max_requests=max(0, min(args.max_requests, 30)),
        time_budget=max(0, args.time_budget), refresh=args.refresh,
    )
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
