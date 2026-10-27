#!/usr/bin/env python3
"""Conservative, offline-at-render-time AniList cover enrichment.

Poor means width < 400 OR height < 600, not an AI/aesthetic judgement.
Run bounded resumable batches: python3 tools/tg/artwork.py --limit 25
No Telegram configuration, credentials, or session files are read.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import io
import json
import os
import re
import tempfile
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
MIN_WIDTH, MIN_HEIGHT = 400, 600
MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 24_000_000
INTERVAL = 3.0
QUERY = """query ($search: String!) {
  Page(page: 1, perPage: 10) {
    media(search: $search, type: ANIME) {
      id type format season seasonYear startDate { year }
      title { romaji english native } synonyms coverImage { extraLarge }
    }
  }
}"""


def read_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def atomic_bytes(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".artwork-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(name)


def atomic_json(path, value):
    atomic_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode())


def normalize(value):
    value = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return " ".join("".join(c if c.isalnum() else " " for c in value).split())


def titles(row):
    return [str(row[k]) for k in ("titleEn", "titleOriginal", "titleJa", "titleMain") if row.get(k)]


def markers(values):
    seasons, parts = set(), set()
    roman = {"II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6}
    for value in values:
        for number in re.findall(r"\b(?:season\s*|s)(\d+)\b|\b(\d+)(?:st|nd|rd|th)\s+season\b", value, re.I):
            seasons.add(int(number[0] or number[1]))
        for number in re.findall(r"\bpart\s*(\d+)\b", value, re.I):
            parts.add(int(number))
        for token in re.findall(r"\b(?:II|III|IV|V|VI)\b", value):
            seasons.add(roman[token])
        tail = re.search(r"\s([2-9])$", value)
        if tail:
            seasons.add(int(tail[1]))
    return seasons, parts


def select_match(row, candidates):
    """Exact identity, compatible year/format/season; never fuzzy-match.

    Unknown year requires two distinct canonical titles (e.g. English + native)
    and one unique result. A single alias cannot disambiguate unknown-year art.
    """
    local_titles = titles(row)
    year = row.get("year")
    known_year = isinstance(year, int) and not isinstance(year, bool) and 1900 <= year <= 2100
    local = {normalize(t) for t in local_titles} - {""}
    wanted_season, wanted_part = markers(local_titles)
    if len(wanted_season) > 1 or len(wanted_part) > 1:
        return None
    matches = {}
    if len(candidates) >= 10:
        return None  # Truncated search results cannot prove an unambiguous match.
    for item in candidates:
        if item.get("type") != "ANIME":
            continue
        canonical = [t for t in (item.get("title") or {}).values() if t]
        aliases = canonical + [t for t in item.get("synonyms", []) if isinstance(t, str)]
        if not local.intersection(normalize(t) for t in aliases):
            continue
        if not known_year and len(local.intersection(normalize(t) for t in canonical)) < 2:
            continue
        candidate_year = (item.get("startDate") or {}).get("year") or item.get("seasonYear")
        if known_year and candidate_year != year:
            continue
        seasons, parts = markers(canonical)
        if seasons != wanted_season or parts != wanted_part:
            continue
        fmt = str(row.get("format") or "").upper()
        if fmt and fmt != item.get("format"):
            continue
        if not fmt:
            expected = {"فیلم": {"MOVIE"}, "OVA": {"OVA", "SPECIAL"}, "سریال": {"TV", "TV_SHORT", "ONA"}}.get(row.get("type"))
            if expected and item.get("format") not in expected:
                continue
            if not expected and item.get("format") == "MOVIE":
                continue
        season = str(row.get("season") or "").upper()
        season = {"بهار": "SPRING", "تابستان": "SUMMER", "پاییز": "FALL", "زمستان": "WINTER"}.get(season, season)
        if season in {"SPRING", "SUMMER", "FALL", "WINTER"} and item.get("season") != season:
            continue
        matches[item.get("id")] = item
    return next(iter(matches.values())) if len(matches) == 1 else None


def local_cover(row, root=ROOT):
    try:
        url = urllib.parse.urlsplit(str(row.get("cover") or ""))
        if url.scheme or url.netloc or "%" in url.path or "\\" in url.path:
            return None
        if any(part in {".", ".."} for part in url.path.split("/")):
            return None
        public = (root / "public").resolve()
        for directory in ("aniplus", "catalog"):
            if not url.path.startswith(f"/covers/{directory}/"):
                continue
            base = (public / "covers" / directory).resolve()
            path = (public / url.path.lstrip("/")).resolve()
            if base.is_relative_to(public) and path.is_relative_to(base) and path.is_file():
                return path
    except (OSError, ValueError, RuntimeError):
        pass
    return None


def dimensions(path):
    try:
        with Image.open(path) as image:
            if image.width * image.height > MAX_PIXELS:
                return None
            image.load()
            return image.size
    except (OSError, ValueError, Image.DecompressionBombError):
        return None


def poor(size):
    return size is None or size[0] < MIN_WIDTH or size[1] < MIN_HEIGHT


def catalogue_rows(current_rows=(), root=ROOT):
    """Include old static catalogue covers, with current worker metadata winning."""
    rows = read_json(root / "src/lib/real-catalog.json", [])
    by_slug = {row["slug"]: row for row in rows if row.get("slug")}
    by_slug.update({row["slug"]: row for row in current_rows if row.get("slug")})
    return list(by_slug.values())


def protected_slugs(root=ROOT):
    # Manual TS entries remain the source of truth; do not inspect generated keys.
    text = (root / "src/lib/artwork-overrides.ts").read_text()
    quoted = re.findall(r'["\']([a-z0-9-]+)["\']\s*:\s*\{\s*cover\s*:', text)
    plain = re.findall(r'\b([a-z][a-z0-9_]*)\s*:\s*\{\s*cover\s*:', text)
    return {"witch-hat-atelier", *quoted, *plain}


def safe_image_url(url):
    parsed = urllib.parse.urlsplit(url)
    return (parsed.scheme == "https" and parsed.hostname == "s4.anilist.co"
            and not parsed.username and not parsed.password and parsed.port in (None, 443)
            and parsed.path.startswith("/file/anilistcdn/media/anime/cover/"))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Artwork redirects are not allowed")


def request_bytes(request, limit):
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
        if int(response.headers.get("Content-Length", "0")) > limit:
            raise ValueError("Oversized response")
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError("Oversized response")
        return data


def search(title):
    request = urllib.request.Request("https://graphql.anilist.co", data=json.dumps({
        "query": QUERY, "variables": {"search": title},
    }).encode(), headers={"Content-Type": "application/json", "User-Agent": "AnimeVerse-Artwork/1.0"})
    payload = json.loads(request_bytes(request, 1024 * 1024))
    if payload.get("errors"):
        raise ValueError("AniList query failed")
    return payload["data"]["Page"]["media"]


def download(url):
    if not safe_image_url(url):
        raise ValueError("Untrusted artwork URL")
    return request_bytes(urllib.request.Request(url, headers={"User-Agent": "AnimeVerse-Artwork/1.0"}), MAX_BYTES)


def build_assets(raw, slug, provider_id, old_size, root=ROOT):
    if not re.fullmatch(r"[a-z0-9-]{1,100}", slug) or not isinstance(provider_id, int):
        raise ValueError("Unsafe artwork identity")
    with Image.open(io.BytesIO(raw)) as source:
        if source.width * source.height > MAX_PIXELS or source.format not in {"JPEG", "PNG", "WEBP"}:
            raise ValueError("Unsupported image")
        source.load()
        image = ImageOps.exif_transpose(source).convert("RGB")
    w, h = image.size
    if (poor((w, h)) or w < old_size[0] or h < old_size[1]
            or w * h < old_size[0] * old_size[1] * 1.5 or not 0.5 <= w / h <= 0.85):
        raise ValueError("Artwork is not a sufficiently larger portrait")
    digest = hashlib.sha256(raw).hexdigest()[:12]
    base = f"/covers/enriched/{slug}-{provider_id}-{digest}"
    paths, widths = {}, {}
    # Content-addressed files are complete before publishing the atomic JSON map.
    for label, bound in (("full", w), ("thumb", 320), ("640", 640), ("1280", 1280)):
        variant = image.copy()
        variant.thumbnail((min(w, bound), h), Image.Resampling.LANCZOS)
        url = base + ("" if label == "full" else "-" + label) + ".webp"
        output = io.BytesIO()
        variant.save(output, "WEBP", quality=88 if label != "thumb" else 78, method=6)
        atomic_bytes(root / "public" / url.lstrip("/"), output.getvalue())
        paths[label], widths[label] = url, variant.width
    srcset = {widths[label]: paths[label] for label in ("640", "1280", "full")}
    return {"cover": paths["full"]}, {"thumb": paths["thumb"], "srcSet": ", ".join(f"{url} {width}w" for width, url in sorted(srcset.items()))}


def enrich(rows, limit=3, root=ROOT):
    """Bounded worker call. Lock + persisted pacing also cover concurrent CLI runs."""
    if limit <= 0:
        return {"attempted": 0, "replaced": 0}
    data = root / "data"
    data.mkdir(exist_ok=True)
    with (data / "artwork.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"attempted": 0, "replaced": 0, "busy": True}
        return _enrich_locked(rows, min(limit, 605), root)


def _enrich_locked(rows, limit, root):
    cache_path = root / "data/artwork-cache.json"
    generated_path = root / "src/lib/generated-artwork.json"
    cache = read_json(cache_path, {"entries": {}})
    generated = read_json(generated_path, {"artwork": {}, "variants": {}})
    protected = protected_slugs(root)
    attempted = replaced = 0
    for row in rows:
        slug = row.get("slug") or ""
        if slug in protected or row.get("artworkOverride") or row.get("coverOverride"):
            continue
        path = local_cover(row, root)
        if path is None:
            continue  # Never fetch arbitrary remote URLs or missing local files.
        size = dimensions(path)
        if not poor(size):
            continue
        size = size or (0, 0)  # Existing corrupt local art can be safely replaced.
        fingerprint = hashlib.sha256(json.dumps([2, titles(row), row.get("year"), row.get("season"), row.get("format"), row.get("type"), str(path), size], ensure_ascii=False).encode()).hexdigest()
        previous = cache.setdefault("entries", {}).get(slug, {})
        if previous.get("status") == "success" and previous.get("fingerprint") != fingerprint:
            # Metadata identity changed: do not serve an earlier season's cached art.
            generated["artwork"].pop(slug, None)
            atomic_json(generated_path, generated)
        if previous.get("fingerprint") == fingerprint and previous.get("expires", 0) > time.time():
            art = generated["artwork"].get(slug, {})
            if previous.get("status") != "success" or (root / "public" / art.get("cover", "").lstrip("/")).is_file():
                continue
        if attempted >= limit or cache.get("blockedUntil", 0) > time.time():
            break
        attempted += 1
        record = {"fingerprint": fingerprint, "checkedAt": time.time()}
        try:
            time.sleep(max(0, cache.get("nextRequestAt", 0) - time.time()))
            cache["nextRequestAt"] = time.time() + INTERVAL
            atomic_json(cache_path, cache)
            candidates = search(next(iter(titles(row)), slug))
            match = select_match(row, candidates)
            if not match:
                record.update(status="no-match", expires=time.time() + 30 * 86400)
            else:
                url = (match.get("coverImage") or {}).get("extraLarge") or ""
                art, variants = build_assets(download(url), slug, match["id"], size, root)
                generated["artwork"][slug] = art
                generated["variants"][art["cover"]] = variants
                atomic_json(generated_path, generated)
                record.update(status="success", expires=time.time() + 3650 * 86400,
                              provider="AniList", providerId=match["id"], sourceUrl=url)
                replaced += 1
        except Exception as exc:
            record.update(status="error", error=type(exc).__name__, expires=time.time() + 86400)
            # Stop the entire batch after rate limiting/network/provider errors;
            # invalid/low-resolution images are cached individually, never retried.
            if not isinstance(exc, ValueError):
                cache["blockedUntil"] = time.time() + 3600
        cache["entries"][slug] = record
        atomic_json(cache_path, cache)
    return {"attempted": attempted, "replaced": replaced}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=3, help="Max candidates this invocation (0 disables; max 605)")
    parser.add_argument("--slug", action="append", help="Only inspect these slugs")
    args = parser.parse_args()
    rows = catalogue_rows()
    if args.slug:
        rows = [row for row in rows if row.get("slug") in args.slug]
    print(json.dumps(enrich(rows, args.limit)), flush=True)


if __name__ == "__main__":
    main()
