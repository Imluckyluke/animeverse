#!/usr/bin/env python3
"""Durable public-reference research for every unmatched copied archive title.

This worker never opens a Telegram session, assigns files or publishes pages.
It completes provider searches, including pagination, for the existing sole
writer's independent per-file identity guards. Partial results are never marked
complete. Restarting resumes from the private cache and provider rate deadline.
"""
import argparse
import fcntl
import json
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import threading
import time
import urllib.error
import urllib.request

from archive_identity import canonical_query, APPROVED_ALIASES, APPROVED_ALIAS_FORMATS, APPROVED_ALIAS_MAL_IDS, names, normalized
from common import DATA, atomic_write_json, now_iso, read_json
from connections import retry_after_seconds

FIELDS = '''id idMal type title{romaji english native} synonyms format episodes
season seasonYear startDate{year month day} status description(asHtml:false) genres duration
coverImage{large} studios(isMain:true){nodes{name}}'''
CACHE = DATA / 'archive-identity-cache.json'
STATUS = DATA / 'archive-full-match/reference-progress.json'
STOP = threading.Event()


def validate_reviewed_lead(lead):
    """Cross-source leads require an individually approved, exact provider fact set."""
    title = lead.get('archiveTitle')
    expected = APPROVED_ALIASES.get(title)
    media = lead.get('media') or {}
    if not expected or media.get('id') != expected[0] or media.get('episodes') != expected[2] or (media.get('startDate') or {}).get('year') != expected[1]:
        raise ValueError('reviewed-lead-identity-conflict')
    if media.get('type') != 'ANIME' or media.get('status') != 'FINISHED' or media.get('format') != APPROVED_ALIAS_FORMATS.get(title, 'TV') or normalized(expected[3]) not in names(media):
        raise ValueError('reviewed-lead-format-or-title-conflict')
    if title in APPROVED_ALIAS_MAL_IDS and media.get('idMal') != APPROVED_ALIAS_MAL_IDS[title]:
        raise ValueError('reviewed-lead-cross-provider-conflict')
    return media


def merge_reviewed_lead(path):
    document = read_json(path, {}) or {}
    leads = document.get('leads') if document.get('version') == 1 else [document]
    if not isinstance(leads, list) or not leads:
        raise ValueError('empty-reviewed-leads')
    # Validate the whole bundle before changing the cache; never partially
    # accept a bundle whose later source record conflicts with its review.
    validated = [(lead, validate_reviewed_lead(lead)) for lead in leads]
    cache = read_json(CACHE, {}) or {}
    for lead, media in validated:
        entry = cache.setdefault(lead['archiveTitle'], {})
        merged = {item['id']: item for item in entry.get('reviewedWebMedia', [])}
        merged[media['id']] = media
        entry.update(reviewedWebMedia=list(merged.values()), reviewedWebComplete=True,
                     reviewedWebSources=lead.get('sourceLinks') or [], reviewedWebCheckedAt=lead.get('checkedAt'))
    atomic_write_json(CACHE, cache)
    print('REVIEWED_WEB_REFERENCES_MERGED', len(validated), flush=True)


def title_inventory(database, research_base_names=False):
    db = sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True)
    try:
        rows = db.execute("""SELECT json_extract(record,'$.title'),count(*) FROM files
            WHERE state='copied' AND anime_key IS NULL GROUP BY 1""").fetchall()
        titles = {title: count for title, count in rows if isinstance(title, str) and title.strip()}
        # Research full filename titles too, including files whose caption used
        # an abbreviated or different-language name. Query intake never changes
        # the source record or constitutes an assignment.
        from backfill import parse_archive_fields, archive_identity_hint
        for ident, raw in db.execute("""SELECT id,record FROM files WHERE state='copied'
                AND anime_key IS NULL"""):
            record = json.loads(raw)
            parsed = (archive_identity_hint(record) if not record.get('title') else
                      parse_archive_fields(record.get('name') or '', '', ident, record.get('size'), record.get('date') or ''))
            if parsed and parsed.get('title') and parsed['title'] != record.get('title'):
                title = parsed['title']
                titles[title] = titles.get(title, 0) + 1
        if research_base_names:
            from season_identity import sequence_markers
            for title, count in list(titles.items()):
                query = canonical_query(title)
                if sequence_markers(query) != {('season', 1)}:
                    continue
                base = re.sub(r'\bSeason\s+1\b', '', query, flags=re.I)
                base = re.sub(r'\s+', ' ', base).strip(' -_:')
                if base and base != query:
                    # A research query only, NOT equivalence or S1 identity
                    # proof. Remake years and other sequence guards stay intact.
                    titles[base] = titles.get(base, 0) + count
        return titles, sum(count for title, count in rows)
    finally:
        db.close()


def pending_tasks(titles, cache, now=None, include_deferred=False):
    now = time.time() if now is None else now
    tasks = []
    for title, count in sorted(titles.items(), key=lambda item: (-item[1], item[0])):
        entry = cache.get(title) or {}
        for kind, query in [('raw', title), ('canonical', canonical_query(title))]:
            if not query or (kind == 'canonical' and query == title):
                continue
            complete = 'complete' if kind == 'raw' else 'canonicalComplete'
            if entry.get(complete):
                continue
            progress = (entry.get('researchPages') or {}).get(kind) or {}
            if not include_deferred and (progress.get('held') or progress.get('retryAt', 0) > now):
                continue
            task = {'title': title, 'kind': kind, 'query': query,
                    'page': progress.get('nextPage', 1), 'files': count}
            if include_deferred:
                task.update(held=bool(progress.get('held')), retryAt=progress.get('retryAt', 0))
            tasks.append(task)
    return tasks


def batch_request(tasks):
    definitions, selections, variables = [], [], {}
    for index, task in enumerate(tasks):
        definitions.extend([f'$s{index}:String', f'$p{index}:Int'])
        selections.append(f'r{index}:Page(page:$p{index},perPage:50){{pageInfo{{hasNextPage}}media(search:$s{index},type:ANIME){{{FIELDS}}}}}')
        variables.update({f's{index}': task['query'], f'p{index}': task['page']})
    return {'query': 'query(' + ','.join(definitions) + '){' + ''.join(selections) + '}', 'variables': variables}


def fetch(tasks):
    request = urllib.request.Request('https://graphql.anilist.co',
        data=json.dumps(batch_request(tasks)).encode(),
        headers={'Content-Type': 'application/json', 'User-Agent': 'AnimeVerse-ArchiveResearch/1.0'})
    with urllib.request.urlopen(request, timeout=45) as response:
        raw = response.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError('oversized-provider-response')
    result = json.loads(raw)
    if result.get('errors') or not isinstance(result.get('data'), dict):
        raise ValueError('provider-query-failed')
    return result['data']


def accept_batch(cache, tasks, data):
    completed = 0
    for index, task in enumerate(tasks):
        page = data.get(f'r{index}')
        if not isinstance(page, dict) or not isinstance(page.get('media'), list) or not isinstance((page.get('pageInfo') or {}).get('hasNextPage'), bool):
            raise ValueError('incomplete-provider-page')
        entry = cache.setdefault(task['title'], {})
        media_field = 'media' if task['kind'] == 'raw' else 'canonicalMedia'
        complete_field = 'complete' if task['kind'] == 'raw' else 'canonicalComplete'
        old = entry.get(media_field, []) if task['page'] > 1 else []
        merged = {item['id']: item for item in old if isinstance(item, dict) and isinstance(item.get('id'), int)}
        for item in page['media']:
            if not isinstance(item, dict) or item.get('type') != 'ANIME' or isinstance(item.get('id'), bool) or not isinstance(item.get('id'), int) or item['id'] <= 0:
                raise ValueError('invalid-provider-identity')
            merged[item['id']] = item
        complete = not page['pageInfo']['hasNextPage']
        entry.update({media_field: list(merged.values()), complete_field: complete, 'checkedAt': now_iso(), 'error': ''})
        progress = {'nextPage': task['page'] + 1, 'query': task['query']}
        if not complete and task['page'] >= 10:
            progress.update(held=True, reason='provider-results-too-broad')
        entry.setdefault('researchPages', {})[task['kind']] = progress
        if task['kind'] == 'canonical':
            entry['canonicalQuery'] = task['query']
        completed += complete
    return completed


def save_progress(titles, total, cache, requests, completed, state, error=''):
    now = time.time()
    tasks = pending_tasks(titles, cache, now=now, include_deferred=True)
    ready = pending_tasks(titles, cache, now=now)
    blocked = (cache.get('__provider__') or {}).get('blockedUntil', 0)
    held = sum(task['held'] for task in tasks)
    deferred = sum(not task['held'] and task['retryAt'] > now for task in tasks)
    if state == 'research_complete':
        if deferred or ready:
            state = 'research_waiting'
        elif held:
            state = 'research_complete_with_holds'
    value = {'updatedAt': now_iso(), 'state': state, 'unmatchedFilesAtInventory': total,
             'titlesAtInventory': len(titles), 'remainingSearches': len(tasks),
             'readySearches': len(ready), 'deferredSearches': deferred,
             'requestsThisRun': requests, 'completedSearchesThisRun': completed,
             'heldBroadSearches': held,
             'providerBlockedUntil': blocked, 'lastError': error,
             'note': 'Completed reference research is not a file assignment or verified publication.'}
    atomic_write_json(STATUS, value)
    return value


def run(batch_size=4, max_requests=0, pause=2, research_base_names=False):
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    cache = read_json(CACHE, {}) or {}
    backup = STATUS.parent / 'reference-cache-before.json'
    if CACHE.exists() and not backup.exists():
        shutil.copy2(CACHE, backup)
    titles, total = title_inventory(DATA / 'archive-pipeline.sqlite3', research_base_names)
    requests = completed = failures = 0
    print('ARCHIVE_REFERENCE_SCOPE', total, len(titles), flush=True)
    while not STOP.is_set():
        if max_requests and requests >= max_requests:
            save_progress(titles, total, cache, requests, completed, 'bounded')
            return
        wait = (cache.get('__provider__') or {}).get('blockedUntil', 0) - time.time()
        if wait > 0:
            save_progress(titles, total, cache, requests, completed, 'provider_wait')
            print('ARCHIVE_REFERENCE_PROVIDER_WAIT', round(wait), flush=True)
            if STOP.wait(wait):
                break
        tasks = pending_tasks(titles, cache)[:max(1, min(batch_size, 8))]
        if not tasks:
            titles, total = title_inventory(DATA / 'archive-pipeline.sqlite3', research_base_names)
            tasks = pending_tasks(titles, cache)[:max(1, min(batch_size, 8))]
            if not tasks:
                waiting = [task['retryAt'] for task in pending_tasks(titles, cache, include_deferred=True)
                           if not task['held'] and task['retryAt'] > time.time()]
                if waiting:
                    save_progress(titles, total, cache, requests, completed, 'research_waiting')
                    if STOP.wait(max(0, min(waiting) - time.time())):
                        break
                    continue
                report = save_progress(titles, total, cache, requests, completed, 'research_complete')
                print('ARCHIVE_REFERENCE_RESEARCH_FINISHED', json.dumps(report), flush=True)
                return
        try:
            requests += 1
            data = fetch(tasks)
            completed += accept_batch(cache, tasks, data)
            failures = 0
            atomic_write_json(CACHE, cache)
            report = save_progress(titles, total, cache, requests, completed, 'running')
            print('ARCHIVE_REFERENCE_BATCH', requests, completed, report['remainingSearches'], flush=True)
        except urllib.error.HTTPError as error:
            failures += 1
            delay = retry_after_seconds((error.headers or {}).get('Retry-After')) if error.code == 429 else None
            delay = delay if delay is not None else min(1800, 60 * 2 ** min(failures, 5))
            cache['__provider__'] = {'blockedUntil': time.time() + delay, 'reason': f'HTTP {error.code}'}
            atomic_write_json(CACHE, cache)
            save_progress(titles, total, cache, requests, completed, 'provider_wait', f'HTTP {error.code}')
        except (OSError, ValueError) as error:
            failures += 1
            delay = min(1800, 30 * 2 ** min(failures, 5))
            cache['__provider__'] = {'blockedUntil': time.time() + delay, 'reason': type(error).__name__}
            atomic_write_json(CACHE, cache)
            save_progress(titles, total, cache, requests, completed, 'provider_wait', type(error).__name__)
            if failures >= 3:
                print('ARCHIVE_REFERENCE_RESEARCH_PAUSED_FOR_REVIEW', type(error).__name__, flush=True)
                return
        if STOP.wait(max(1, pause)):
            break
    save_progress(titles, total, cache, requests, completed, 'stopped')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--batch-size', type=int, default=4)
    parser.add_argument('--max-requests', type=int, default=0, help='0 researches the entire remaining scope')
    parser.add_argument('--merge-web-lead', type=Path)
    parser.add_argument('--research-base-names', action='store_true', help='Research base names of explicit S1 labels, never infer that they are equivalent')
    args = parser.parse_args()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: STOP.set())
    with (DATA / 'archive-reference-research.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.merge_web_lead:
            merge_reviewed_lead(args.merge_web_lead)
        else:
            run(args.batch_size, max(0, args.max_requests), research_base_names=args.research_base_names)
