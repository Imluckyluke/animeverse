#!/usr/bin/env python3
"""Read-only MAL reference research for names not resolved by AniList.

Jikan exposes public MyAnimeList metadata. This worker writes a separate private
research cache only: it never changes the identity cache, records, assignments,
catalogue, notifications or Telegram sessions. Search hits are research leads,
not identity certificates. Every page must finish before a query is complete.
"""
import argparse
import fcntl
import json
import signal
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from archive_identity import APPROVED_ALIASES, canonical_query, identity_names, normalized, reference_lookup, reference_candidates
from archive_reference_research import title_inventory
from common import DATA, atomic_write_json, now_iso, read_json
from connections import retry_after_seconds

CACHE = DATA / 'archive-full-match/mal-reference-cache.json'
STATUS = DATA / 'archive-full-match/mal-reference-progress.json'
STOP = threading.Event()
FIELDS = ('mal_id', 'url', 'title', 'titles', 'title_english', 'title_japanese',
          'title_synonyms', 'type', 'episodes', 'status', 'aired', 'year', 'season')


def unresolved_queries(titles, identity_cache):
    """Research alternate references; never weaken the primary identity test."""
    result = {}
    lookup = reference_lookup(identity_cache)
    for title, count in titles.items():
        if title in APPROVED_ALIASES:
            continue
        if any(normalized(canonical_query(title)) in identity_names(media)
               for media in reference_candidates(title, identity_cache.get(title) or {}, lookup)):
            continue
        query = canonical_query(title)
        if query:
            result[query] = result.get(query, 0) + count
    return result


def next_tasks(queries, cache):
    entries = cache.get('queries') or {}
    return [{'query': query, 'files': count, 'page': (entries.get(query) or {}).get('nextPage', 1)}
            for query, count in sorted(queries.items(), key=lambda pair: (-pair[1], pair[0]))
            if not (entries.get(query) or {}).get('complete') and not (entries.get(query) or {}).get('held')]


def fetch(task):
    query = urllib.parse.urlencode({'q': task['query'], 'page': task['page'], 'limit': 25})
    request = urllib.request.Request('https://api.jikan.moe/v4/anime?' + query,
                                    headers={'User-Agent': 'AnimeVerse-ArchiveReferenceReview/1.0'})
    with urllib.request.urlopen(request, timeout=45) as response:
        raw = response.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError('oversized-alternate-reference-response')
    return json.loads(raw)


def accept_page(cache, task, result):
    if not isinstance(result, dict):
        raise ValueError('invalid-alternate-reference-response')
    pagination = result.get('pagination') or {}
    if (not isinstance(pagination, dict) or not isinstance(result.get('data'), list)
            or not isinstance(pagination.get('has_next_page'), bool)
            or pagination.get('current_page', task['page']) != task['page']):
        raise ValueError('incomplete-alternate-reference-page')
    records = []
    for item in result['data']:
        if not isinstance(item, dict) or isinstance(item.get('mal_id'), bool) or not isinstance(item.get('mal_id'), int) or item['mal_id'] <= 0:
            raise ValueError('invalid-alternate-provider-identity')
        records.append({field: item.get(field) for field in FIELDS})
    entry = cache.setdefault('queries', {}).setdefault(task['query'], {})
    old = entry.get('media', []) if task['page'] > 1 else []
    merged = {item['mal_id']: item for item in old}
    merged.update({item['mal_id']: item for item in records})
    complete = not pagination['has_next_page']
    entry.update(media=list(merged.values()), complete=complete, checkedAt=now_iso(),
                 nextPage=task['page'] + 1, error='')
    if not complete and task['page'] >= 10:
        entry.update(held=True, reason='alternate-results-too-broad')
    return complete


def save_progress(queries, total, cache, requests, state, error=''):
    entries = cache.get('queries') or {}
    held = sum(bool((entries.get(query) or {}).get('held')) for query in queries)
    complete = sum(bool((entries.get(query) or {}).get('complete')) for query in queries)
    remaining = len(queries) - complete
    if state == 'research_complete' and remaining:
        state = 'research_complete_with_holds' if held == remaining else 'research_incomplete'
    value = {'updatedAt': now_iso(), 'state': state, 'unmatchedFilesAtInventory': total,
             'queriesAtInventory': len(queries), 'completedQueries': complete,
             'remainingQueries': remaining, 'heldQueries': held, 'requestsThisRun': requests,
             'providerBlockedUntil': (cache.get('provider') or {}).get('blockedUntil', 0),
             'lastError': error, 'note': 'Alternate public references are research leads, NOT assignments or publication.'}
    atomic_write_json(STATUS, value)
    return value


def run(max_requests=0):
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    cache = read_json(CACHE, {}) or {'version': 1, 'queries': {}}
    titles, total = title_inventory(DATA / 'archive-pipeline.sqlite3')
    queries = unresolved_queries(titles, read_json(DATA / 'archive-identity-cache.json', {}) or {})
    requests = failures = 0
    print('ALTERNATE_REFERENCE_SCOPE', total, len(queries), flush=True)
    while not STOP.is_set():
        if max_requests and requests >= max_requests:
            save_progress(queries, total, cache, requests, 'bounded')
            return
        wait = (cache.get('provider') or {}).get('blockedUntil', 0) - time.time()
        if wait > 0:
            save_progress(queries, total, cache, requests, 'provider_wait')
            if STOP.wait(wait):
                break
        tasks = next_tasks(queries, cache)
        if not tasks:
            report = save_progress(queries, total, cache, requests, 'research_complete')
            print('ALTERNATE_REFERENCE_FINISHED', json.dumps(report), flush=True)
            return
        task = tasks[0]
        try:
            requests += 1
            accept_page(cache, task, fetch(task))
            failures = 0
            atomic_write_json(CACHE, cache)
            report = save_progress(queries, total, cache, requests, 'running')
            print('ALTERNATE_REFERENCE_PAGE', requests, report['completedQueries'], report['remainingQueries'], flush=True)
        except urllib.error.HTTPError as error:
            failures += 1
            if error.code in {400, 404, 422}:
                cache.setdefault('queries', {}).setdefault(task['query'], {}).update(
                    held=True, complete=False, reason='alternate-query-rejected', error=f'HTTP {error.code}')
                failures = 0
            else:
                retry = retry_after_seconds((error.headers or {}).get('Retry-After')) if error.code == 429 else None
                cache['provider'] = {'blockedUntil': time.time() + (retry if retry is not None else min(1800, 60 * 2 ** min(failures, 5))),
                                     'reason': f'HTTP {error.code}'}
            atomic_write_json(CACHE, cache)
            save_progress(queries, total, cache, requests, 'provider_wait', f'HTTP {error.code}')
        except (ValueError, OSError) as error:
            failures += 1
            cache['provider'] = {'blockedUntil': time.time() + min(1800, 60 * 2 ** min(failures, 5)), 'reason': type(error).__name__}
            atomic_write_json(CACHE, cache)
            save_progress(queries, total, cache, requests, 'provider_wait', type(error).__name__)
        if failures >= 3:
            save_progress(queries, total, cache, requests, 'paused_for_review', 'repeated-provider-failure')
            print('ALTERNATE_REFERENCE_PAUSED_FOR_REVIEW', flush=True)
            return
        if STOP.wait(1.25):
            break
    save_progress(queries, total, cache, requests, 'stopped')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--max-requests', type=int, default=0, help='0 researches the full remaining query inventory')
    args = parser.parse_args()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: STOP.set())
    with (DATA / 'archive-alternate-reference-research.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        run(max(0, args.max_requests))
