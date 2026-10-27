#!/usr/bin/env python3
"""Offline, rate-limited replacement of portrait/cropped/poor hero banners.
No invented widescreen crops: only genuine, identity-checked AniList banners.
"""
import argparse
import contextlib
import fcntl
import hashlib
import io
import json
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request

from PIL import Image, ImageOps
import artwork

ROOT = artwork.ROOT
QUERY = artwork.QUERY.replace('coverImage { extraLarge }', 'coverImage { extraLarge } bannerImage')


def local_path(url, root=ROOT):
    parsed = urllib.parse.urlsplit(str(url or ''))
    if parsed.scheme or parsed.netloc or '%' in parsed.path or '\\' in parsed.path:
        return None
    if not parsed.path.startswith(('/covers/', '/banners/')) or any(p in {'.', '..'} for p in parsed.path.split('/')):
        return None
    public = (root / 'public').resolve()
    path = (public / parsed.path.lstrip('/')).resolve()
    return path if path.is_relative_to(public) and path.is_file() else None


def suitable(size):
    return bool(size and size[0] >= 1000 and size[1] >= 240 and 1.65 <= size[0] / size[1] <= 5.5)


def needs_banner(row, root=ROOT):
    path = local_path(row.get('banner'), root)
    # These source-worker files are crops of portrait covers, not native banners.
    synthetic = str(row.get('banner', '')).startswith('/covers/aniplus/')
    return synthetic or path is None or not suitable(artwork.dimensions(path))


def search(title):
    request = urllib.request.Request('https://graphql.anilist.co', data=json.dumps({
        'query': QUERY, 'variables': {'search': title}}).encode(),
        headers={'Content-Type': 'application/json', 'User-Agent': 'AnimeVerse-Artwork/1.0'})
    payload = json.loads(artwork.request_bytes(request, 1024 * 1024))
    if payload.get('errors'):
        raise ValueError('Banner query failed')
    return payload['data']['Page']['media']


def safe_url(url):
    p = urllib.parse.urlsplit(url)
    return (p.scheme == 'https' and p.hostname == 's4.anilist.co' and not p.username and not p.password
            and p.port in (None, 443) and p.path.startswith('/file/anilistcdn/media/anime/banner/'))


def build_assets(raw, slug, provider_id, root=ROOT):
    if not re.fullmatch(r'[a-z0-9-]{1,100}', slug) or not isinstance(provider_id, int):
        raise ValueError('Unsafe banner identity')
    with Image.open(io.BytesIO(raw)) as source:
        if source.width * source.height > artwork.MAX_PIXELS or source.format not in {'JPEG', 'PNG', 'WEBP'}:
            raise ValueError('Unsafe banner image')
        source.load()
        image = ImageOps.exif_transpose(source).convert('RGB')
    if not suitable(image.size):
        raise ValueError('Banner too small or wrong aspect ratio')
    digest = hashlib.sha256(raw).hexdigest()[:12]
    base = f'/banners/enriched/{slug}-{provider_id}-{digest}'
    paths = {}
    widths = {}
    for label, bound in [('thumb', 480), ('960', 960), ('full', 1920)]:
        variant = image.copy()
        variant.thumbnail((min(image.width, bound), image.height), Image.Resampling.LANCZOS)
        url = base + ('' if label == 'full' else '-' + label) + '.webp'
        output = io.BytesIO()
        variant.save(output, 'WEBP', quality=86 if label != 'thumb' else 76, method=6)
        artwork.atomic_bytes(root / 'public' / url.lstrip('/'), output.getvalue())
        paths[label], widths[label] = url, variant.width
    srcset = {widths[label]: paths[label] for label in ['960', 'full']}
    return {'banner': paths['full']}, {'thumb': paths['thumb'], 'srcSet': ', '.join(f'{url} {width}w' for width, url in sorted(srcset.items()))}


def write_dimensions(root=ROOT):
    urls = set()
    for row in artwork.catalogue_rows(root=root):
        urls.update(row.get(field) or '' for field in ['cover', 'banner'])
    for filename in ['generated-artwork.json', 'generated-banners.json']:
        data = artwork.read_json(root / 'src/lib' / filename, {})
        for row in data.get('artwork', {}).values():
            urls.update(row.values())
    text = (root / 'src/lib/artwork-overrides.ts').read_text()
    urls.update(re.findall(r'["\'](/(?:covers|banners)/[^"\']+)["\']', text))
    # Existing demo art is also local, but never imported by a client catalogue.
    text = (root / 'src/lib/images.ts').read_text() if (root / 'src/lib/images.ts').exists() else ''
    urls.update(re.findall(r'["\'](/(?:covers|banners)/[^"\']+)["\']', text))
    sizes = {}
    for url in sorted(urls):
        path = local_path(url, root)
        if path:
            try:
                with Image.open(path) as image:
                    sizes[urllib.parse.urlsplit(url).path] = list(image.size)
            except (OSError, ValueError):
                pass
    artwork.atomic_json(root / 'src/lib/artwork-dimensions.json', sizes)


def enrich(rows, limit=3, root=ROOT):
    data = root / 'data'
    data.mkdir(exist_ok=True)
    with (data / 'artwork.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'attempted': 0, 'replaced': 0, 'busy': True}
        cache_path = data / 'banner-cache.json'
        cache = artwork.read_json(cache_path, {'entries': {}})
        output_path = root / 'src/lib/generated-banners.json'
        generated = artwork.read_json(output_path, {'artwork': {}, 'variants': {}})
        protected = artwork.protected_slugs(root)
        attempted = replaced = 0
        for row in rows:
            slug = row.get('slug') or ''
            if slug in protected or row.get('artworkOverride') or row.get('bannerOverride') or not needs_banner(row, root):
                continue
            fingerprint = hashlib.sha256(json.dumps([1, artwork.titles(row), row.get('year'), row.get('season'), row.get('format'), row.get('type'), row.get('banner')], ensure_ascii=False).encode()).hexdigest()
            previous = cache['entries'].get(slug, {})
            if previous.get('fingerprint') != fingerprint and previous.get('status') == 'success':
                generated['artwork'].pop(slug, None)
                artwork.atomic_json(output_path, generated)
            if previous.get('fingerprint') == fingerprint and previous.get('expires', 0) > time.time():
                art = generated['artwork'].get(slug, {})
                if previous.get('status') != 'success' or local_path(art.get('banner'), root):
                    continue
            if attempted >= max(0, min(limit, 605)) or cache.get('blockedUntil', 0) > time.time():
                break
            attempted += 1
            record = {'fingerprint': fingerprint, 'checkedAt': time.time()}
            try:
                time.sleep(max(0, cache.get('nextRequestAt', 0) - time.time()))
                cache['nextRequestAt'] = time.time() + artwork.INTERVAL
                artwork.atomic_json(cache_path, cache)
                match = artwork.select_match(row, search(next(iter(artwork.titles(row)), slug)))
                url = match.get('bannerImage') if match else None
                if not url:
                    record.update(status='no-match', expires=time.time() + 30 * 86400)
                else:
                    if not safe_url(url):
                        raise ValueError('Untrusted banner URL')
                    raw = artwork.request_bytes(urllib.request.Request(url, headers={'User-Agent': 'AnimeVerse-Artwork/1.0'}), artwork.MAX_BYTES)
                    art, variant = build_assets(raw, slug, match['id'], root)
                    generated['artwork'][slug] = art
                    generated['variants'][art['banner']] = variant
                    artwork.atomic_json(output_path, generated)
                    record.update(status='success', providerId=match['id'], sourceUrl=url, expires=time.time() + 3650 * 86400)
                    replaced += 1
            except Exception as error:
                record.update(status='error', error=type(error).__name__, expires=time.time() + 86400)
                if not isinstance(error, ValueError):
                    cache['blockedUntil'] = time.time() + 3600
            cache['entries'][slug] = record
            artwork.atomic_json(cache_path, cache)
        write_dimensions(root)
        return {'attempted': attempted, 'replaced': replaced}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=3)
    args = parser.parse_args()
    print(json.dumps(enrich(artwork.catalogue_rows(), args.limit)), flush=True)
