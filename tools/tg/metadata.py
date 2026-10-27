#!/usr/bin/env python3
"""Cached, identity-checked missing metadata enrichment, never during rendering.
Only explicit provider facts are accepted. No post-date or current-year fallback.
"""
import argparse
import fcntl
import hashlib
import json
import time
import urllib.request

import artwork
from quality import clean_season

ROOT = artwork.ROOT
QUERY = artwork.QUERY.replace('coverImage { extraLarge }', 'episodes duration studios(isMain: true) { nodes { name } }')
FA_DIGITS = str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹')


def positive(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def missing(value):
    return not value or value in {'—', '-', 'نامشخص', 'نامعلوم'}


def apply_metadata(row, entries):
    entry = entries.get(row.get('slug')) or {}
    identity, values = entry.get('identity') or {}, entry.get('data') or {}
    if identity.get('titleEn') != row.get('titleEn') or identity.get('titleJa', '') != row.get('titleJa', ''):
        return row
    if row.get('year') and values.get('year') and row['year'] != values['year']:
        return row
    result = dict(row)
    year = values.get('year')
    if not row.get('year') and isinstance(year, int) and not isinstance(year, bool) and 1900 <= year <= 2100:
        result['year'] = year
    if missing(row.get('season')) and values.get('season'):
        result['season'] = values['season']
    for key in ['duration', 'studio', 'format']:
        if missing(row.get(key)) and values.get(key):
            result[key] = values[key]
    total = values.get('totalEpisodes')
    if not positive(row.get('totalEpisodes')) and positive(total) and total >= row.get('highestEpisode', 0):
        result['totalEpisodes'] = total
        result['episodes'] = total
    return result


def provider_values(match, row):
    values = {}
    year = (match.get('startDate') or {}).get('year') or match.get('seasonYear')
    if isinstance(year, int) and not isinstance(year, bool) and 1900 <= year <= 2100:
        values['year'] = year
    season = clean_season(match.get('season'))
    if season != 'نامشخص':
        values['season'] = season
    total = match.get('episodes')
    if positive(total) and total >= row.get('highestEpisode', 0):
        values['totalEpisodes'] = total
    duration = match.get('duration')
    if positive(duration) and duration <= 500:
        values['duration'] = str(duration).translate(FA_DIGITS) + ' دقیقه'
    studios = [item.get('name') for item in (match.get('studios') or {}).get('nodes', []) if item.get('name')]
    if studios:
        values['studio'] = ' / '.join(studios)
    if match.get('format') in {'TV', 'TV_SHORT', 'ONA', 'OVA', 'MOVIE', 'SPECIAL', 'MUSIC'}:
        values['format'] = match['format']
    return values


def search(title):
    request = urllib.request.Request('https://graphql.anilist.co', data=json.dumps({
        'query': QUERY, 'variables': {'search': title}}).encode(),
        headers={'Content-Type': 'application/json', 'User-Agent': 'AnimeVerse-Metadata/1.0'})
    result = json.loads(artwork.request_bytes(request, 1024 * 1024))
    if result.get('errors'):
        raise ValueError('Metadata query failed')
    return result['data']['Page']['media']


def enrich(rows, limit=3, root=ROOT, years_only=False):
    (root / 'data').mkdir(exist_ok=True)
    with (root / 'data/artwork.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'attempted': 0, 'replaced': 0, 'busy': True}
        cache_path = root / 'data/metadata-cache.json'
        output_path = root / 'src/lib/generated-metadata.json'
        cache = artwork.read_json(cache_path, {'entries': {}})
        output = artwork.read_json(output_path, {'metadata': {}})
        attempted = replaced = errors = 0
        for row in rows:
            if years_only and row.get('year'):
                continue
            if all([row.get('year'), not missing(row.get('season')), not missing(row.get('studio')), row.get('totalEpisodes')]):
                continue
            slug = row.get('slug') or ''
            if not slug:
                continue
            fingerprint = hashlib.sha256(json.dumps([artwork.titles(row), row.get('year'), row.get('season'), row.get('format'), row.get('type')], ensure_ascii=False).encode()).hexdigest()
            previous = cache['entries'].get(slug, {})
            if previous.get('fingerprint') == fingerprint and previous.get('expires', 0) > time.time():
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
                if not match:
                    record.update(status='no-match', expires=time.time() + 7 * 86400)
                else:
                    values = provider_values(match, row)
                    entry = {'identity': {'titleEn': row.get('titleEn'), 'titleJa': row.get('titleJa', '')}, 'providerId': match['id'], 'data': values}
                    if output['metadata'].get(slug) != entry:
                        output['metadata'][slug] = entry
                        artwork.atomic_json(output_path, output)
                        replaced += int(apply_metadata(row, {slug: entry}) != row)
                    record.update(status='success', providerId=match['id'], expires=time.time() + 86400)
                errors = 0
            except Exception as error:
                record.update(status='error', error=type(error).__name__, expires=time.time() + 3600)
                errors += 1
                if getattr(error, 'code', None) == 429 or errors >= 3:
                    cache['blockedUntil'] = time.time() + 3600
            cache['entries'][slug] = record
            artwork.atomic_json(cache_path, cache)
        return {'attempted': attempted, 'replaced': replaced}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=3)
    parser.add_argument('--missing-years-only', action='store_true')
    args = parser.parse_args()
    print(json.dumps(enrich(artwork.catalogue_rows(), args.limit, years_only=args.missing_years_only)), flush=True)
