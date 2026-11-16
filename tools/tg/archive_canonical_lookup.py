"""Fetch complete reference results for conservative archive-label/season queries.

This changes only the public provider cache. It never assigns archive files.
"""
from collections import defaultdict
import argparse
from email.utils import parsedate_to_datetime
import json
import re
import sqlite3
import time

from archive_identity import canonical_query, entry_media, identity_names, normalized, safe_episode_record, search
from common import DATA, atomic_write_json, now_iso


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--filenames', action='store_true')
    mode.add_argument('--base-seasons', action='store_true', help='Discovery only: fetch franchise names without season labels')
    args = parser.parse_args()
    path = DATA / 'archive-identity-cache.json'
    cache = json.loads(path.read_text())
    database = sqlite3.connect('file:' + str(DATA / 'archive-pipeline.sqlite3') + '?mode=ro', uri=True)
    titles = [row[0] for row in database.execute("""SELECT json_extract(record,'$.title') AS title
        FROM files WHERE state='copied' AND anime_key IS NULL AND title IS NOT NULL
        GROUP BY title ORDER BY count(*) DESC""")]
    if args.filenames:
        from backfill import parse_archive_fields
        filename_titles = set()
        for row in database.execute("SELECT id,record FROM files WHERE state='copied' AND anime_key IS NULL"):
            old = json.loads(row[1])
            if safe_episode_record(old):
                continue
            parsed = parse_archive_fields(old.get('name') or '', '', row[0], old.get('size'), old.get('date', ''))
            if parsed and safe_episode_record(parsed) and not cache.get(parsed['title'], {}).get('complete'):
                filename_titles.add(parsed['title'])
        titles = sorted(filename_titles)
    database.close()
    queries = defaultdict(list)
    for title in titles:
        entry = cache.get(title, {})
        query = canonical_query(title)
        if args.base_seasons:
            query = re.sub(r'\bSeason\s+\d{1,2}\b', '', query, flags=re.I).strip(' -:()')
            corrections = {'Future Diary (Mirai Nikki': 'Mirai Nikki',
                           'Toaru Majutsu Index ll': 'Toaru Majutsu no Index',
                           'Toaru Majutsu Railgun': 'Toaru Kagaku no Railgun'}
            query = corrections.get(title, query)
            if not query or entry.get('baseComplete') or normalized(query) == normalized(title):
                continue
            queries[query].append(title)
            continue
        if not query or (not args.filenames and (entry.get('canonicalComplete') or normalized(query) == normalized(title))):
            continue
        if any(normalized(query) in identity_names(media) for media in entry_media(entry)):
            continue
        queries[query].append(title)
    print('CANONICAL_REFERENCE_QUERIES', len(queries), flush=True)
    deadline = time.monotonic() + 7200
    for query, raw_titles in queries.items():
        if time.monotonic() >= deadline:
            print('CANONICAL_REFERENCE_WINDOW_ENDED', flush=True)
            break
        for attempt in range(3):
            blocked = cache.get('__provider__', {}).get('blockedUntil', 0) - time.time()
            if blocked > 0:
                if time.monotonic() + blocked >= deadline:
                    print('CANONICAL_COOLDOWN_EXCEEDS_WINDOW', flush=True)
                    return
                time.sleep(blocked)
            try:
                media = search(query)
                for title in raw_titles:
                    if args.base_seasons:
                        cache.setdefault(title, {}).update(baseQuery=query, baseMedia=media,
                            baseComplete=True, baseCheckedAt=now_iso(), baseError='')
                    elif args.filenames:
                        cache.setdefault(title, {}).update(query=query, querySource='filename', media=media,
                            complete=True, checkedAt=now_iso(), error='')
                    else:
                        cache.setdefault(title, {}).update(canonicalQuery=query, canonicalMedia=media,
                            canonicalComplete=True, canonicalCheckedAt=now_iso(), canonicalError='')
                print('CANONICAL_REFERENCE_CHECKED', query, len(media), flush=True)
                break
            except Exception as error:
                for title in raw_titles:
                    if args.base_seasons:
                        cache.setdefault(title, {}).update(baseQuery=query, baseComplete=False,
                            baseError=type(error).__name__, baseCheckedAt=now_iso())
                    elif args.filenames:
                        cache.setdefault(title, {}).update(query=query, querySource='filename', complete=False,
                            error=type(error).__name__, checkedAt=now_iso())
                    else:
                        cache.setdefault(title, {}).update(canonicalQuery=query, canonicalComplete=False,
                            canonicalError=type(error).__name__, canonicalCheckedAt=now_iso())
                print('CANONICAL_REFERENCE_DEFERRED', query, type(error).__name__, flush=True)
                if getattr(error, 'code', None) != 429:
                    break
                headers = getattr(error, 'headers', {}) or {}
                retry, reset = headers.get('Retry-After', ''), headers.get('X-RateLimit-Reset', '')
                until = max(time.time() + 120, time.time() + int(retry) if str(retry).isdigit() else 0,
                            int(reset) + 2 if str(reset).isdigit() else 0)
                if retry and not str(retry).isdigit():
                    try:
                        until = max(until, parsedate_to_datetime(retry).timestamp() + 2)
                    except (ValueError, TypeError):
                        pass
                cache['__provider__'] = {'blockedUntil': until, 'reason': 'HTTP 429'}
                atomic_write_json(path, cache)
        atomic_write_json(path, cache)
        time.sleep(4)
    print('CANONICAL_REFERENCE_RUN_FINISHED', flush=True)


if __name__ == '__main__':
    main()
