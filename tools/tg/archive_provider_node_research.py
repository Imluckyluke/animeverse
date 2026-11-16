#!/usr/bin/env python3
"""Fetch primary provider nodes for cross-reference leads, without applying them.

The private input report contains literal names and linked public provider IDs.
Those links are leads, not trusted aliases. Actual AniList nodes are fetched into
a separate cache. No primary matching cache, source record, Telegram session,
assignment, catalogue, download job or notification is changed by this worker.
"""
import argparse
import copy
import fcntl
import json
import signal
import threading
import time
import urllib.error
import urllib.request

from archive_identity import entry_media
from archive_reference_research import FIELDS
from common import DATA, atomic_write_json, now_iso, read_json
from connections import retry_after_seconds

CACHE = DATA / 'archive-full-match/provider-node-research-cache.json'
STATUS = DATA / 'archive-full-match/provider-node-research-progress.json'
STOP = threading.Event()
PRIMARY_NODE_KEY = '__direct_primary_nodes__'
PRIMARY_FIELDS = ('id', 'idMal', 'type', 'title', 'synonyms', 'format', 'episodes', 'season', 'seasonYear',
                  'startDate', 'status', 'description', 'genres', 'duration', 'coverImage', 'studios')


def primary_cache_with_nodes(identity_cache, document):
    """Stage actual primary responses only; never import a snapshot's aliases.

    This is pure and does not write either cache. The caller must preview file
    plans and separately authorize the metadata-only handoff to the sole writer.
    """
    if document.get('version') != 1 or not isinstance(document.get('nodes'), dict):
        raise ValueError('invalid-primary-node-cache')
    previous = identity_cache.get(PRIMARY_NODE_KEY) or {}
    if previous and previous.get('source') != 'anilist-direct-id':
        raise ValueError('primary-node-cache-key-already-in-use')
    merged = {media['id']: media for media in previous.get('reviewedWebMedia', [])}
    imported, skipped = [], 0
    for key, node in document['nodes'].items():
        if node.get('complete') is not True:
            skipped += 1
            continue
        media = node.get('media') or {}
        ident = media.get('id')
        required = {'id', 'idMal', 'type', 'title', 'synonyms', 'format', 'episodes', 'startDate', 'status'}
        if (isinstance(ident, bool) or not isinstance(ident, int) or ident <= 0 or str(ident) != key
                or media.get('type') != 'ANIME' or not required <= media.keys()
                or not isinstance(media.get('title'), dict) or not isinstance(media.get('synonyms'), list)
                or not isinstance(media.get('startDate'), dict)):
            raise ValueError('primary-node-shape-or-id-conflict')
        if media.get('episodes') is not None and (isinstance(media['episodes'], bool) or not isinstance(media['episodes'], int) or media['episodes'] < 0):
            raise ValueError('primary-node-episode-conflict')
        merged[ident] = {field: copy.deepcopy(media[field]) for field in PRIMARY_FIELDS if field in media}
        imported.append(ident)
    if not imported:
        raise ValueError('no-complete-primary-nodes-to-stage')
    result = dict(identity_cache)
    result[PRIMARY_NODE_KEY] = {'source': 'anilist-direct-id', 'checkedAt': now_iso(),
        'reviewedWebComplete': True, 'reviewedWebMedia': [merged[ident] for ident in sorted(merged)],
        'importedPrimaryIds': sorted(imported), 'skippedIncompleteNodes': skipped,
        'note': 'Only actual complete AniList response fields; snapshot titles and aliases are not imported.'}
    return result


def node_inventory(report, identity_cache):
    known = {media['id']: media for entry in identity_cache.values() for media in entry_media(entry)}
    nodes = {}
    for entry in report.get('entries') or []:
        for candidate in entry['candidates']:
            for ident in candidate['anilistIds']:
                if isinstance(ident, bool) or not isinstance(ident, int) or ident <= 0:
                    raise ValueError('invalid-linked-provider-id')
                media = known.get(ident) or {}
                if (media.get('type') == 'ANIME' and media.get('idMal') and media.get('format')
                        and media.get('status') and media.get('episodes') is not None
                        and (media.get('startDate') or {}).get('year')):
                    continue
                evidence = nodes.setdefault(ident, {'queries': [], 'expectedFacts': []})
                if entry['query'] not in evidence['queries']:
                    evidence['queries'].append(entry['query'])
                facts = {key: candidate.get(key) for key in ('title', 'malIds', 'type', 'episodes', 'status', 'year', 'sources')}
                if facts not in evidence['expectedFacts']:
                    evidence['expectedFacts'].append(facts)
    return nodes


def accept_nodes(cache, requested, response):
    page = response.get('Page') if isinstance(response, dict) else None
    if (not isinstance(page, dict) or not isinstance(page.get('media'), list)
            or not isinstance(page.get('pageInfo'), dict) or page['pageInfo'].get('hasNextPage') is not False):
        raise ValueError('incomplete-provider-node-response')
    found = {}
    for media in page['media']:
        if (not isinstance(media, dict) or media.get('type') != 'ANIME'
                or isinstance(media.get('id'), bool) or not isinstance(media.get('id'), int)
                or media['id'] not in requested or media['id'] in found):
            raise ValueError('unexpected-provider-node')
        found[media['id']] = media
    nodes = cache.setdefault('nodes', {})
    for ident in requested:
        if ident in found:
            nodes[str(ident)] = {'complete': True, 'checkedAt': now_iso(), 'media': found[ident]}
        else:
            nodes[str(ident)] = {'complete': False, 'held': True, 'checkedAt': now_iso(), 'reason': 'provider-node-not-returned'}


def fetch(ids):
    query = 'query($ids:[Int]){Page(page:1,perPage:50){pageInfo{hasNextPage}media(id_in:$ids,type:ANIME){' + FIELDS + '}}}'
    request = urllib.request.Request('https://graphql.anilist.co', data=json.dumps({'query': query, 'variables': {'ids': ids}}).encode(),
                                    headers={'Content-Type': 'application/json', 'User-Agent': 'AnimeVerse-CrossReferenceReview/1.0'})
    with urllib.request.urlopen(request, timeout=45) as response:
        raw = response.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError('oversized-provider-node-response')
    result = json.loads(raw)
    if not isinstance(result, dict) or result.get('errors') or not isinstance(result.get('data'), dict):
        raise ValueError('provider-node-query-failed')
    return result['data']


def save_progress(inventory, cache, requests, state, error=''):
    nodes = cache.get('nodes') or {}
    complete = sum(bool((nodes.get(str(ident)) or {}).get('complete')) for ident in inventory)
    held = sum(bool((nodes.get(str(ident)) or {}).get('held')) for ident in inventory)
    if state == 'research_complete' and held:
        state = 'research_complete_with_holds'
    report = {'updatedAt': now_iso(), 'state': state, 'nodesAtInventory': len(inventory),
              'completedNodes': complete, 'heldNodes': held, 'remainingNodes': len(inventory) - complete,
              'requestsThisRun': requests, 'lastError': error,
              'note': 'Fresh primary nodes are research evidence only, not certified file assignments or publication.'}
    atomic_write_json(STATUS, report)
    return report


def run(batch_size=10, max_requests=0):
    report = read_json(DATA / 'archive-full-match/offline-reference-leads.json', {}) or {}
    identity = read_json(DATA / 'archive-identity-cache.json', {}) or {}
    inventory = node_inventory(report, identity)
    cache = read_json(CACHE, {}) or {'version': 1, 'nodes': {}}
    cache['inventory'] = {str(ident): evidence for ident, evidence in inventory.items()}
    cache['datasetLastUpdate'] = report.get('datasetLastUpdate')
    shared_deadline = (identity.get('__provider__') or {}).get('blockedUntil', 0)
    del identity
    requests = failures = 0
    print('PROVIDER_NODE_RESEARCH_SCOPE', len(inventory), flush=True)
    while not STOP.is_set():
        if max_requests and requests >= max_requests:
            save_progress(inventory, cache, requests, 'bounded')
            return
        nodes = cache.get('nodes') or {}
        pending = [ident for ident in sorted(inventory) if not (nodes.get(str(ident)) or {}).get('complete')
                   and not (nodes.get(str(ident)) or {}).get('held')]
        if not pending:
            atomic_write_json(CACHE, cache)
            print('PROVIDER_NODE_RESEARCH_FINISHED', json.dumps(save_progress(inventory, cache, requests, 'research_complete')), flush=True)
            return
        wait = max(shared_deadline, (cache.get('provider') or {}).get('blockedUntil', 0)) - time.time()
        if wait > 0:
            save_progress(inventory, cache, requests, 'provider_wait')
            if STOP.wait(wait): break
        try:
            requests += 1
            ids = pending[:max(1, min(50, batch_size))]
            accept_nodes(cache, ids, fetch(ids))
            failures = 0
            atomic_write_json(CACHE, cache)
            progress = save_progress(inventory, cache, requests, 'running')
            print('PROVIDER_NODE_RESEARCH_BATCH', requests, progress['completedNodes'], progress['remainingNodes'], flush=True)
        except (urllib.error.HTTPError, OSError, ValueError) as error:
            failures += 1
            retry = retry_after_seconds((error.headers or {}).get('Retry-After')) if isinstance(error, urllib.error.HTTPError) and error.code == 429 else None
            cache['provider'] = {'blockedUntil': time.time() + (retry if retry is not None else min(1800, 60 * 2 ** min(failures, 5))),
                                 'reason': f'HTTP {error.code}' if isinstance(error, urllib.error.HTTPError) else type(error).__name__}
            atomic_write_json(CACHE, cache)
            save_progress(inventory, cache, requests, 'provider_wait', cache['provider']['reason'])
            if failures >= 3:
                save_progress(inventory, cache, requests, 'paused_for_review', cache['provider']['reason'])
                return
        if STOP.wait(3): break
    save_progress(inventory, cache, requests, 'stopped')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--batch-size', type=int, default=10)
    parser.add_argument('--max-requests', type=int, default=0)
    args = parser.parse_args()
    for sig in (signal.SIGTERM, signal.SIGINT): signal.signal(sig, lambda *_: STOP.set())
    with (DATA / 'archive-provider-node-research.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        run(args.batch_size, max(0, args.max_requests))
