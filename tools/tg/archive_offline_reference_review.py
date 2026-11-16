#!/usr/bin/env python3
"""Find literal cross-provider research leads in a public metadata snapshot.

The manami-project dataset aggregates provider names and source URLs. It is not
an identity authority: stale facts, merged entries and punctuation collisions
must still be reviewed against primary sources and individual archive files.
This command writes a separate private report only. It cannot assign, publish,
modify the identity cache, open Telegram sessions or create notifications.
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import re

from archive_alternate_reference_research import unresolved_queries
from archive_identity import canonical_query, entry_media, normalized
from archive_reference_research import title_inventory
from common import DATA, atomic_write_json, now_iso, read_json


def source_ids(urls, host):
    pattern = r'https://' + re.escape(host) + r'/anime/([1-9]\d*)(?:/[^\s]*)?'
    return sorted({int(match[1]) for url in urls if isinstance(url, str)
                   and (match := re.fullmatch(pattern, url))})


def literal_candidates(queries, records):
    wanted = defaultdict(list)
    for query in queries:
        wanted[normalized(canonical_query(query))].append(query)
    candidates = defaultdict(list)
    for record in records:
        names = [record.get('title'), *(record.get('synonyms') or [])]
        hits = defaultdict(list)
        for name in names:
            if not isinstance(name, str) or not name:
                continue
            for query in wanted.get(normalized(canonical_query(name)), []):
                hits[query].append(name)
        for query, evidence in hits.items():
            sources = record.get('sources') or []
            candidates[query].append({'title': record.get('title'), 'literalNameEvidence': sorted(set(evidence)),
                'type': record.get('type'), 'episodes': record.get('episodes'), 'status': record.get('status'),
                'year': (record.get('animeSeason') or {}).get('year'),
                'anilistIds': source_ids(sources, 'anilist.co'), 'malIds': source_ids(sources, 'myanimelist.net'),
                'sources': sources})
    return dict(candidates)


def cross_reference(candidate, primary):
    conflicts = []
    if primary.get('id') not in candidate['anilistIds']:
        conflicts.append('anilist-id')
    if primary.get('idMal') not in candidate['malIds']:
        conflicts.append('mal-id')
    for field, observed in [('episodes', primary.get('episodes')), ('type', primary.get('format')),
                            ('year', (primary.get('startDate') or {}).get('year'))]:
        if candidate.get(field) is None or observed is None or candidate[field] != observed:
            conflicts.append(field)
    expected_status = {'FINISHED': 'FINISHED', 'ONGOING': 'RELEASING', 'UPCOMING': 'NOT_YET_RELEASED'}.get(candidate.get('status'))
    if expected_status is None or primary.get('status') != expected_status:
        conflicts.append('status')
    return {'providerId': primary.get('id'), 'conflicts': conflicts,
            'factsAgree': not conflicts, 'certifiedAssignment': False,
            'primaryFacts': {field: primary.get(field) for field in ('id', 'idMal', 'title', 'format', 'status', 'episodes', 'startDate')}}


def review(path):
    dataset = read_json(path, {}) or {}
    if dataset.get('repository') != 'https://github.com/manami-project/anime-offline-database' or not isinstance(dataset.get('data'), list):
        raise ValueError('unexpected-public-reference-dataset')
    titles, total = title_inventory(DATA / 'archive-pipeline.sqlite3')
    cache = read_json(DATA / 'archive-identity-cache.json', {}) or {}
    queries = unresolved_queries(titles, cache)
    candidates = literal_candidates(queries, dataset['data'])
    needed = {ident for items in candidates.values() for item in items for ident in item['anilistIds']}
    primary = {media['id']: media for entry in cache.values() for media in entry_media(entry) if media['id'] in needed}
    entries = []
    for query, items in sorted(candidates.items(), key=lambda pair: (-queries[pair[0]], pair[0])):
        for item in items:
            item['primaryCrossChecks'] = [cross_reference(item, primary[ident]) for ident in item['anilistIds'] if ident in primary]
        entries.append({'query': query, 'queryWeight': queries[query], 'candidates': items})
    report = {'checkedAt': now_iso(), 'datasetLastUpdate': dataset.get('lastUpdate'),
              'datasetRepository': dataset['repository'], 'datasetLicense': dataset.get('license'),
              'unmatchedFilesAtInventory': total, 'researchedNames': len(queries), 'namesWithLiteralLeads': len(entries),
              'entries': entries, 'assignmentsChanged': False,
              'note': 'Literal third-party names and cross-provider links are leads only; even agreeing facts do NOT certify an archive file.'}
    atomic_write_json(DATA / 'archive-full-match/offline-reference-leads.json', report)
    print('OFFLINE_REFERENCE_LEADS', json.dumps({key: value for key, value in report.items() if key != 'entries'}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, required=True)
    args = parser.parse_args()
    review(args.dataset)
