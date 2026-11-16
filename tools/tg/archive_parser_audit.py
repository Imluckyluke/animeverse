"""Audit every currently unmatched copied file without modifying live records.

Optionally request bounded exact-document metadata inspection for video records
whose original parser omitted quality/title. This is not a match/apply command.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sqlite3

from archive_review import review_rows
from backfill import archive_identity_hint, VIDEO_EXTS
from common import DATA, atomic_write_json, now_iso, read_json


def request_resolution_conflicts(output):
    """Request exact dimensions, not a guessed resolution or source rewrite."""
    from resolver import _quality_of
    files = []
    with sqlite3.connect('file:' + str(DATA / 'archive-pipeline.sqlite3') + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute('BEGIN')
        for row in db.execute("SELECT * FROM files WHERE state='copied' AND anime_key IS NULL ORDER BY id"):
            raw = json.loads(row['record'])
            if (not row['document_id'] or not row['destination_id']
                    or Path(raw.get('name') or '').suffix.lower() not in VIDEO_EXTS):
                continue
            filename = _quality_of(raw.get('name') or '')[0]
            caption = _quality_of(raw.get('caption') or '')[0]
            recorded = _quality_of(raw.get('quality') or '')[0]
            if not filename or not any(value and value != filename for value in (caption, recorded)):
                continue
            files.append({'id': row['id'], 'documentId': str(row['document_id']),
                          'recordSha256': hashlib.sha256(row['record'].encode()).hexdigest(), 'inspectHeader': True})
    if len(files) > 1024:
        raise ValueError('Resolution conflict inspection requires a smaller reviewed scope')
    request = {'version': 3, 'createdBy': 'archive-parser-audit-v1', 'createdAt': now_iso(),
               'purpose': 'explicit-filename-caption-resolution-conflicts', 'files': files}
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    atomic_write_json(output / 'request.json', request)
    if files:
        # Preserve the preceding completed request; the inspector itself keeps
        # earlier immutable document observations when advancing to this batch.
        previous = read_json(DATA / 'archive-full-match/video-metadata-request.json', {})
        atomic_write_json(output / 'previous-request.json', previous)
        atomic_write_json(DATA / 'archive-full-match/video-metadata-request.json', request)
    print('RESOLUTION_CONFLICT_INSPECTION_REQUESTED', len(files), 'LIVE_RECORDS_CHANGED', False, flush=True)
    return request


def audit(output, request_metadata=False):
    with sqlite3.connect('file:' + str(DATA / 'archive-pipeline.sqlite3') + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute('BEGIN')
        rows = [{**dict(row), 'parsed': json.loads(row['record'])} for row in db.execute(
            "SELECT * FROM files WHERE state='copied' AND anime_key IS NULL ORDER BY id")]
        bindings = {row['title']: dict(row) for row in db.execute('SELECT * FROM bindings')}
    decisions = review_rows(rows, read_json(DATA / 'aniplus-state.json', {}),
                            read_json(DATA / 'archive-identity-cache.json', {}), bindings)
    assert len(decisions) == len(rows) == len({row['id'] for row in decisions})
    counts = Counter()
    requests = []
    roster = []
    for row in rows:
        raw = row['parsed']
        hint = archive_identity_hint(raw)
        missing = [key for key in ('title', 'episode', 'quality') if not raw.get(key)]
        counts.update('missing_' + key for key in missing)
        counts['titleRecoveredForDisplay'] += bool(not raw.get('title') and hint.get('title'))
        counts['episodeRecoveredForDisplay'] += bool(not raw.get('episode') and hint.get('episode'))
        counts['explicitQualityRecoveredForDisplay'] += bool(not raw.get('quality') and hint.get('quality'))
        proof = {'id': row['id'], 'recordSha256': hashlib.sha256(row['record'].encode()).hexdigest(),
                 'documentId': str(row['document_id'])}
        roster.append({**proof, 'missingFields': missing})
        if (not raw.get('quality') and Path(raw.get('name') or '').suffix.lower() in VIDEO_EXTS
                and row['document_id'] and row['destination_id']):
            requests.append({**proof, 'inspectHeader': True})
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    summary = {'observedAt': now_iso(), 'unmatchedFiles': len(rows), 'accountedFiles': len(decisions),
               'allFilesChecked': True, 'allFilesMatched': False, 'liveRecordsChanged': False,
               'statusCounts': dict(Counter(row['status'] for row in decisions)),
               'parserCounts': dict(counts), 'requestedMetadataFiles': len(requests),
               'note': 'Parser hints, research and holds are not matches. Every apply requires separate source guards and review.'}
    atomic_write_json(output / 'summary.json', summary)
    atomic_write_json(output / 'files.json', {'summary': summary, 'roster': roster, 'decisions': decisions})
    if request_metadata:
        assert len(requests) <= 1024
        atomic_write_json(DATA / 'archive-full-match/video-metadata-request.json', {
            'version': 3, 'createdBy': 'archive-parser-audit-v1', 'createdAt': now_iso(),
            'files': requests})
    print('GLOBAL_UNMATCHED_PARSER_AUDIT', json.dumps(summary, ensure_ascii=False), flush=True)
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--request-metadata', action='store_true')
    parser.add_argument('--request-resolution-conflicts', action='store_true')
    args = parser.parse_args()
    if args.request_resolution_conflicts:
        if args.request_metadata:
            parser.error('Choose one metadata inspection mode')
        request_resolution_conflicts(args.output)
    else:
        audit(args.output, args.request_metadata)
