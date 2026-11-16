"""Read-only, full-inventory Roman/season audit; never changes source bindings.

Inspect every file, every canonical page and every attached download slot. Exact
destination/document IDs connect ready links to source filenames, not title
similarity. Ambiguous symbols and absent provenance are explicitly unverified.
"""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import sqlite3

from season_identity import ambiguous_roman_change, conflicts, page_markers, record_markers, roman_tokens, sequence_markers


def audit(state, db, destination_username='testanivers'):
    anime = state.get('anime', {})
    rows = [dict(row) for row in db.execute('SELECT id,record,document_id,destination_id,anime_key,state FROM files')]
    by_id, by_document, by_destination = {}, defaultdict(list), defaultdict(list)
    counts = Counter(allPages=len(anime), allFiles=len(rows))
    pages, file_issues, slot_issues = {}, [], []
    for key, item in anime.items():
        tokens = [token for field in ('titleEn', 'titleOriginal') for token in roman_tokens(item.get(field))]
        if tokens:
            pages[key] = {'key': key, 'slug': item.get('slug'), 'titleEn': item.get('titleEn'),
                          'titleOriginal': item.get('titleOriginal'), 'romanTokens': sorted(set(tokens)),
                          'markers': sorted(page_markers(item))}
    for row in rows:
        row['data'] = json.loads(row['record'])
        by_id[row['id']] = row
        if row['document_id']:
            by_document[str(row['document_id'])].append(row)
        if row['destination_id']:
            by_destination[int(row['destination_id'])].append(row)
    for document, destination in db.execute('SELECT document_id,message_id FROM destination'):
        for row in by_document.get(str(document), []):
            if row not in by_destination[int(destination)]:
                by_destination[int(destination)].append(row)
    for row in rows:
        data, key = row['data'], row['anime_key']
        tokens = [token for field in ('title', 'name', 'caption') for token in roman_tokens(data.get(field))]
        if not tokens and key not in pages:
            continue
        counts['candidateFiles'] += 1
        counts['candidateBoundFiles' if key else 'candidateUnboundFiles'] += 1
        markers = record_markers(data)
        reasons = []
        if conflicts(markers):
            reasons.append('source-marker-conflict')
        if key in anime and conflicts(page_markers(anime[key]), markers):
            reasons.append('page-file-marker-conflict')
        if key in anime and anime[key].get('metadataSource') != 'anilist' and ambiguous_roman_change(anime[key], data):
            reasons.append('ambiguous-roman-notation')
        if reasons:
            file_issues.append({'id': row['id'], 'key': key, 'filename': data.get('name'),
                                'title': data.get('title'), 'reasons': reasons,
                                'markers': sorted(markers), 'state': row['state']})
    all_ready = 0
    ready_urls = defaultdict(set)
    for key, item in anime.items():
        page = page_markers(item)
        if key in pages and conflicts(page):
            pages[key]['conflict'] = True
        for number, qualities in item.get('episodes', {}).items():
            for quality, deep in qualities.items():
                queued = state.get('queue', {}).get(deep, {})
                ready = queued.get('status') == 'done' and str(queued.get('url', '')).startswith('https://')
                all_ready += bool(ready)
                dest = None
                url = queued.get('url') or ''
                if url.startswith('https://t.me/' + destination_username + '/') and url.rsplit('/', 1)[-1].isdigit():
                    dest = int(url.rsplit('/', 1)[-1])
                sources = list(by_destination.get(dest, [])) if ready else []
                ident = queued.get('archiveRecordId')
                if not ident and str(deep).startswith('archive:'):
                    ident = str(deep).split(':', 1)[1]
                if not sources and ident and str(ident).isdigit() and int(ident) in by_id:
                    candidate = by_id[int(ident)]
                    # A queued archive ID alone does not certify a ready URL.
                    if not ready or candidate['destination_id'] == dest:
                        sources = [candidate]
                if key not in pages and not any(roman_tokens(source['data'].get(field))
                    for source in sources for field in ('title', 'name', 'caption')):
                    continue
                counts['candidateSlots'] += 1
                counts['candidateReadySlots' if ready else 'candidatePendingSlots'] += 1
                if ready:
                    ready_urls[key].add(url)
                reasons = set()
                if conflicts(page):
                    reasons.add('page-marker-conflict')
                for source in sources:
                    markers = record_markers(source['data'])
                    if conflicts(markers):
                        reasons.add('source-marker-conflict')
                    if conflicts(page, markers):
                        reasons.add('page-file-marker-conflict')
                    if item.get('metadataSource') != 'anilist' and ambiguous_roman_change(item, source['data']):
                        reasons.add('ambiguous-roman-notation')
                if not sources:
                    reasons.add('provenance-unverified')
                if reasons:
                    slot_issues.append({'key': key, 'slug': item.get('slug'), 'episode': number,
                        'quality': quality, 'deep': deep, 'ready': bool(ready), 'url': url,
                        'sourceIds': [source['id'] for source in sources], 'reasons': sorted(reasons)})
    duplicates = []
    keys = sorted(ready_urls)
    for i, left in enumerate(keys):
        for right in keys[i + 1:]:
            overlap = ready_urls[left] & ready_urls[right]
            if overlap:
                duplicates.append({'keys': [left, right], 'sharedExactUrls': len(overlap),
                                   'readyUrls': [len(ready_urls[left]), len(ready_urls[right])]})
    definite = {'source-marker-conflict', 'page-file-marker-conflict', 'page-marker-conflict'}
    counts.update(romanCandidatePages=len(pages), fileConflicts=sum(bool(definite & set(issue['reasons'])) for issue in file_issues),
                  slotIssues=len(slot_issues), allReadySlots=all_ready, duplicatePagePairs=len(duplicates))
    counts['conflictingReadySlots'] = sum(issue['ready'] and bool(definite & set(issue['reasons'])) for issue in slot_issues)
    counts['ambiguousReadySlots'] = sum(issue['ready'] and 'ambiguous-roman-notation' in issue['reasons'] for issue in slot_issues)
    counts['unverifiedReadySlots'] = sum(issue['ready'] and 'provenance-unverified' in issue['reasons'] for issue in slot_issues)
    return {'readOnly': True, 'summary': dict(counts), 'pages': list(pages.values()),
            'fileIssues': file_issues, 'slotIssues': slot_issues, 'duplicatePages': duplicates,
            'limits': ['Source labels are constraints, not independent content certification.',
                       'Bare I/V/X and franchise/game numbers are not automatically seasons.',
                       'No file, link, page, transfer or binding is changed.']}


def main():
    from common import DATA, DEST_USERNAME, atomic_write_json, load_state, now_iso
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DATA / 'archive-roman-season-audit.json')
    args = parser.parse_args()
    # A consistent read transaction; no schema migration or writer lock.
    with sqlite3.connect('file:' + str(DATA / 'archive-pipeline.sqlite3') + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute('BEGIN')
        report = {**audit(load_state(), db, DEST_USERNAME), 'checkedAt': now_iso()}
    atomic_write_json(args.output, report)
    print(json.dumps(report['summary'], ensure_ascii=False))


if __name__ == '__main__':
    main()
