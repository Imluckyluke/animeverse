#!/usr/bin/env python3
"""Repair archive-backed catalog pages without disturbing the copy queue.

Two problems are fixed here:
  1. Non-ASCII display titles leaked into ``slug``. Next.js cannot serve those
     static routes reliably, so the cards existed but opened a 404 page.
  2. Covers hosted on dead hotlink hosts disappeared. Every cover is copied to
     ``public/covers/catalog`` locally; AniList is used as the alternate source
     when the original URL is unavailable.

The script is idempotent. By default it saves the state atomically after all
changes and regenerates the static catalog. Run it while the backfill copier is
stopped so the state file is not being written concurrently.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import difflib
import hashlib
import io
import json
import re
import shutil
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any

import requests
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "tg"))

from common import DATA, STATE_PATH, atomic_write_json  # noqa: E402
from catalog import write_catalog  # noqa: E402

COVER_DIR = ROOT / "public" / "covers" / "catalog"
COVER_DIR.mkdir(parents=True, exist_ok=True)
CACHE_PATH = DATA / "cover-repair-cache.json"
ANILIST_CACHE_PATH = DATA / "anilist-search-cache.json"
BACKUP_DIR = DATA / "backups"
BACKUP_DIR.mkdir(exist_ok=True)

UA = "AnimeverseCoverRepair/1.0 (+https://github.com)"
ANILIST_API = "https://graphql.anilist.co"
ANILIST_QUERY = """
query ($search: String) {
  Page(perPage: 6) {
    media(search: $search, type: ANIME) {
      id
      title { romaji english native }
      coverImage { extraLarge large }
      bannerImage
    }
  }
}
"""
REQUEST_TIMEOUT = 25
MAX_IMAGE_BYTES = 22 * 1024 * 1024
PERSIAN_RE = re.compile(r"[\u0600-\u06FF]")

# A few AniList records are not returned by their storefront/archive title.
# Keep the alternate query beside the repair logic so a cleared cache can be
# rebuilt without losing these covers again.
MANUAL_QUERIES = {
    "harknights-fuyukomori-kaerimichi": "Arknights: Touin Kiro",
    "hbinghuo-mochu": "Bing Huo Mo Chu",
    "hfantasy-bishoujo-juniku-ojisan-to": "Fantasy Bishoujo Juniku Oji-san to",
    "hhanyou-no-yashahime": "Hanyou no Yashahime: Ni no Shou",
    "hisekai-ojisan": "Isekai Oji-san",
    "htasogare-out-focus": "Tasogare Outfocus",
    "humibe-no-tranger": "Umibe no Étranger",
}


def read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback


def slug_base(value: str) -> str:
    """ASCII-only slug. Never returns a non-ASCII URL segment."""
    text = unicodedata.normalize("NFKD", (value or "").strip())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("&", " and ").replace("+", " plus ")
    text = re.sub(r"['’`]", "", text)
    text = re.sub(r"[^A-Za-z0-9]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-").lower()
    return text[:80].strip("-")


def ascii_title(value: str) -> str:
    value = (value or "").strip()
    if not value or PERSIAN_RE.search(value):
        return ""
    cleaned = re.sub(r"\s+", " ", value)
    return cleaned if re.search(r"[A-Za-z]", cleaned) else ""


def unique_slug(base: str, used: set[str], key: str) -> str:
    base = base or f"anime-{key.lower()}"
    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base}-{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def repair_slugs(state: dict[str, Any]) -> tuple[int, dict[str, str]]:
    """Replace Persian slugs with stable ASCII slugs and update queue rows."""
    anime_map = state.get("anime") or {}
    used = {
        str(anime.get("slug") or "")
        for anime in anime_map.values()
        if anime.get("slug") and not any(ord(ch) > 127 for ch in str(anime.get("slug")))
    }
    replacements: dict[str, str] = {}
    changed = 0

    for key, anime in anime_map.items():
        old = str(anime.get("slug") or "")
        if not old or not any(ord(ch) > 127 for ch in old):
            continue

        # The archive parser often puts the Persian display label in titleEn
        # while keeping the real English title in titleOriginal. Prefer the
        # latter so cards and routes are readable.
        preferred = (
            ascii_title(str(anime.get("titleOriginal") or ""))
            or ascii_title(str(anime.get("titleEn") or ""))
            or ascii_title(str(anime.get("hashtag") or "").replace("_", " "))
            or ""
        )
        base = slug_base(preferred) or f"anime-{key.lower()}"
        new = unique_slug(base, used, key)
        anime["slug"] = new
        replacements[old] = new
        changed += 1

        # A Persian titleEn makes the card title look like a broken slug.
        original = ascii_title(str(anime.get("titleOriginal") or ""))
        if original and PERSIAN_RE.search(str(anime.get("titleEn") or "")):
            anime["titleEn"] = original

    if replacements:
        for item in (state.get("queue") or {}).values():
            if not isinstance(item, dict):
                continue
            anime_key = item.get("animeKey")
            old_slug = item.get("slug")
            if anime_key in anime_map and anime_map[anime_key].get("slug") in replacements.values():
                item["slug"] = anime_map[anime_key]["slug"]
            elif old_slug in replacements:
                item["slug"] = replacements[old_slug]
    return changed, replacements


def cache_lookup(cache: dict[str, Any], key: str) -> dict[str, Any] | None:
    item = cache.get(key)
    if not isinstance(item, dict):
        return None
    if item.get("status") == "done":
        cover = ROOT / "public" / str(item.get("cover") or "").lstrip("/")
        if cover.is_file():
            return item
    if item.get("status") == "missing":
        stamp = item.get("checkedAt") or ""
        try:
            checked = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
            if (dt.datetime.now(dt.timezone.utc) - checked).days < 7:
                return item
        except (ValueError, TypeError):
            pass
    return None


def is_local_image(src: str) -> bool:
    if not src.startswith("/"):
        return False
    # Legacy AniPlus covers carry a cache-busting query string. Next.js still
    # serves the underlying public file, so the query must not make the path
    # look remote (which previously left 65 covers out of cover-map.json).
    path = src.split("?", 1)[0].split("#", 1)[0].lstrip("/")
    return (ROOT / "public" / path).is_file()


def download(url: str) -> bytes | None:
    if not url or not url.startswith(("http://", "https://")):
        return None
    for attempt in range(2):
        try:
            with requests.get(
                url,
                timeout=REQUEST_TIMEOUT,
                headers={"User-Agent": UA, "Accept": "image/avif,image/webp,image/*,*/*"},
                stream=True,
            ) as response:
                if response.status_code != 200:
                    return None
                ctype = (response.headers.get("Content-Type") or "").lower()
                if "image" not in ctype and not url.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                    return None
                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_content(64 * 1024):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > MAX_IMAGE_BYTES:
                        return None
                    chunks.append(chunk)
                return b"".join(chunks) if chunks else None
        except requests.RequestException:
            if attempt == 0:
                time.sleep(1.2)
    return None


def save_webp(content: bytes, dest: Path, max_size: tuple[int, int], quality: int = 84) -> bool:
    try:
        image = Image.open(io.BytesIO(content))
        image.load()
        image = ImageOps.exif_transpose(image)
        if image.width < 80 or image.height < 80:
            return False
        if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
            image = image.convert("RGBA")
            background = Image.new("RGBA", image.size, (10, 10, 17, 255))
            image = Image.alpha_composite(background, image).convert("RGB")
        else:
            image = image.convert("RGB")
        image.thumbnail(max_size, Image.Resampling.LANCZOS)
        dest.parent.mkdir(parents=True, exist_ok=True)
        image.save(dest, "WEBP", quality=quality, method=6)
        return True
    except (OSError, ValueError, Image.UnidentifiedImageError):
        return False


def anilist_search(title: str, cache: dict[str, Any], request_lock: Any) -> dict[str, Any] | None:
    query = re.sub(r"\s+", " ", title or "").strip()
    if not query:
        return None
    hit = cache.get(query)
    if isinstance(hit, dict):
        if hit.get("result"):
            return hit["result"]
        if hit.get("missing"):
            return None

    payload = {"query": ANILIST_QUERY, "variables": {"search": query}}
    for attempt in range(4):
        try:
            with request_lock:
                response = requests.post(
                    ANILIST_API,
                    json=payload,
                    timeout=REQUEST_TIMEOUT,
                    headers={"User-Agent": UA, "Accept": "application/json"},
                )
                if response.status_code == 429:
                    wait = int(response.headers.get("Retry-After") or 8)
                    time.sleep(max(2, min(wait, 60)))
                    continue
                response.raise_for_status()
                data = response.json()
            media = ((data.get("data") or {}).get("Page") or {}).get("media") or []
            if not media:
                cache[query] = {"missing": True, "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat()}
                return None
            wanted = re.sub(r"[^a-z0-9]+", " ", query.lower()).strip()
            best = None
            best_score = 0.0
            for item in media:
                titles = item.get("title") or {}
                candidates = [titles.get("english"), titles.get("romaji"), titles.get("native")]
                score = 0.0
                for candidate in candidates:
                    if not candidate:
                        continue
                    normalized = re.sub(r"[^a-z0-9]+", " ", str(candidate).lower()).strip()
                    ratio = difflib.SequenceMatcher(None, wanted, normalized).ratio()
                    if normalized == wanted:
                        ratio = 1.0
                    score = max(score, ratio)
                if score > best_score:
                    best_score = score
                    best = item
            # AniList relevance is strong for exact romanized titles. Keep a
            # conservative threshold so a wrong franchise cover is not used.
            if not best or best_score < 0.56:
                cache[query] = {"missing": True, "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat()}
                return None
            cover = ((best.get("coverImage") or {}).get("extraLarge") or (best.get("coverImage") or {}).get("large") or "")
            banner = best.get("bannerImage") or ""
            result = {
                "id": best.get("id"),
                "title": (best.get("title") or {}).get("romaji") or (best.get("title") or {}).get("english"),
                "cover": cover,
                "banner": banner,
                "score": round(best_score, 3),
            }
            cache[query] = {"result": result, "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat()}
            return result
        except (requests.RequestException, ValueError):
            if attempt == 3:
                return None
            time.sleep(2 + attempt * 2)
    return None


def perform_repair(args: argparse.Namespace) -> int:
    state = read_json(STATE_PATH, None)
    if not isinstance(state, dict):
        raise SystemExit("state file is not readable")

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = BACKUP_DIR / f"aniplus-state.pre-catalog-repair-{stamp}.json"
    shutil.copy2(STATE_PATH, backup)

    slug_changed, replacements = repair_slugs(state)
    print(f"slug replacements: {slug_changed}")
    for old, new in replacements.items():
        print(f"  {old} -> {new}")

    if args.skip_covers:
        atomic_write_json(STATE_PATH, state)
        catalog, links = write_catalog(state)
        print(f"state saved; catalog={len(catalog)} links={len(links)}")
        return 0

    cache = read_json(CACHE_PATH, {})
    if not isinstance(cache, dict):
        cache = {}
    search_cache = read_json(ANILIST_CACHE_PATH, {})
    if not isinstance(search_cache, dict):
        search_cache = {}
    cover_map = read_json(DATA / "cover-map.json", {})
    if not isinstance(cover_map, dict):
        cover_map = {}

    anime_map = state.get("anime") or {}
    records: list[tuple[str, dict[str, Any]]] = []
    tasks: list[tuple[str, dict[str, Any], str]] = []
    for key, anime in anime_map.items():
        if not anime.get("episodes"):
            continue
        records.append((key, anime))
        cover = str(anime.get("cover") or anime.get("coverUrl") or "")
        cached = cache_lookup(cache, key)
        if cached and cached.get("status") == "done":
            anime["cover"] = cached["cover"]
            anime["banner"] = cached.get("banner") or cached["cover"]
            cover_map[key] = cached
        elif cover and is_local_image(cover):
            anime["cover"] = cover
            if not anime.get("banner") or not is_local_image(str(anime.get("banner") or "")):
                anime["banner"] = cover
            cover_map[key] = {"status": "done", "cover": cover, "banner": anime["banner"], "source": "local"}
        elif cover.startswith(("http://", "https://")):
            tasks.append((key, anime, cover))

    print(f"local/cached covers: {len(records) - len(tasks)}; remote to check: {len(tasks)}")

    downloaded: dict[str, tuple[bytes | None, str]] = {}
    if tasks:
        def fetch_task(task: tuple[str, dict[str, Any], str]) -> tuple[str, bytes | None, str]:
            _key, _anime, url = task
            return _key, download(url), url

        with concurrent.futures.ThreadPoolExecutor(max_workers=18) as pool:
            for key, content, url in pool.map(fetch_task, tasks):
                downloaded[key] = (content, url)

    missing: list[tuple[str, dict[str, Any], str]] = []
    for key, anime, url in tasks:
        content, original = downloaded.get(key, (None, url))
        if content:
            base = str(anime.get("slug") or key)
            dest = COVER_DIR / f"{base}.webp"
            if save_webp(content, dest, (900, 1350)):
                local = f"/covers/catalog/{dest.name}"
                anime["cover"] = local
                anime["banner"] = local
                item = {"status": "done", "cover": local, "banner": local, "source": "original", "original": original, "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat()}
                cache[key] = item
                cover_map[key] = item
                continue
        missing.append((key, anime, url))

    print(f"alternate cover lookup needed: {len(missing)}")
    request_lock = __import__("threading").Lock()
    for index, (key, anime, old_url) in enumerate(missing, start=1):
        if args.max_alternate and index > args.max_alternate:
            break
        query = MANUAL_QUERIES.get(key) or (
            ascii_title(str(anime.get("titleOriginal") or ""))
            or ascii_title(str(anime.get("titleEn") or ""))
            or ascii_title(str(anime.get("hashtag") or "").replace("_", " "))
            or str(anime.get("titleFa") or "").strip()
        )
        result = anilist_search(query, search_cache, request_lock) if query else None
        if result and result.get("cover"):
            content = download(str(result["cover"]))
            base = str(anime.get("slug") or key)
            dest = COVER_DIR / f"{base}.webp"
            if content and save_webp(content, dest, (900, 1350)):
                local = f"/covers/catalog/{dest.name}"
                anime["cover"] = local
                banner_local = local
                banner_url = result.get("banner") or ""
                if banner_url:
                    banner_content = download(str(banner_url))
                    banner_dest = COVER_DIR / f"{base}-banner.webp"
                    if banner_content and save_webp(banner_content, banner_dest, (1600, 900), 82):
                        banner_local = f"/covers/catalog/{banner_dest.name}"
                anime["banner"] = banner_local
                item = {
                    "status": "done",
                    "cover": local,
                    "banner": banner_local,
                    "source": "anilist",
                    "anilistId": result.get("id"),
                    "matchedTitle": result.get("title"),
                    "score": result.get("score"),
                    "query": query,
                    "original": old_url,
                    "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                }
                cache[key] = item
                cover_map[key] = item
                print(f"  [{index}/{len(missing)}] {key}: {result.get('title')} ({result.get('score')})")
                if index % 8 == 0:
                    atomic_write_json(CACHE_PATH, cache)
                    atomic_write_json(ANILIST_CACHE_PATH, search_cache)
                time.sleep(0.8)
                continue
        cache[key] = {
            "status": "missing",
            "original": old_url,
            "query": query,
            "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        cover_map[key] = cache[key]
        # Keep the old URL in coverUrl for a later retry, but clear cover so
        # the site uses its designed gradient poster instead of a broken image.
        if anime.get("cover") == old_url:
            anime["cover"] = ""
            anime["banner"] = ""
        print(f"  [{index}/{len(missing)}] no match: {key} ({query[:50]})")
        if index % 8 == 0:
            atomic_write_json(CACHE_PATH, cache)
            atomic_write_json(ANILIST_CACHE_PATH, search_cache)

    atomic_write_json(CACHE_PATH, cache)
    atomic_write_json(ANILIST_CACHE_PATH, search_cache)
    atomic_write_json(DATA / "cover-map.json", cover_map)
    atomic_write_json(STATE_PATH, state)
    catalog, links = write_catalog(state)
    recovered = sum(1 for item in cover_map.values() if isinstance(item, dict) and item.get("status") == "done")
    print(f"state saved; catalog={len(catalog)} links={len(links)} covers={recovered}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="report only")
    parser.add_argument("--skip-covers", action="store_true", help="repair slugs only")
    parser.add_argument("--max-alternate", type=int, default=0)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if args.dry_run:
        state = read_json(STATE_PATH, {})
        anime_map = state.get("anime") or {}
        bad = [(k, a.get("slug"), a.get("titleOriginal"), a.get("titleEn")) for k, a in anime_map.items() if any(ord(ch) > 127 for ch in str(a.get("slug") or ""))]
        print(f"non-ascii slugs: {len(bad)}")
        for row in bad:
            print(" | ".join(str(x) for x in row))
        print(f"catalog-state anime: {len(anime_map)}")
        return 0
    if args.force:
        try:
            CACHE_PATH.unlink()
        except FileNotFoundError:
            pass
    return perform_repair(args)


if __name__ == "__main__":
    raise SystemExit(main())
