#!/usr/bin/env python3
"""Build a certified filename-recovery preview without writing the live database.

The sole archive writer rechecks source hashes, filename/document evidence and
the current identity planner before accepting any preview. No Telegram client,
source file deletion, existing assignment change or public publishing happens here.
"""
import hashlib
import argparse
import json
from pathlib import Path
import sqlite3
import tempfile

from archive_identity import recover_filename_records
from common import DATA, atomic_write_json, load_state, now_iso, read_json


def approve_offline_preview(path, output, target=None):
    """Guard an operator-reviewed/rehearsed preview for the sole writer.

    This only records approval/provenance; it never writes live source records
    or contacts Telegram. The writer independently repeats all apply guards.
    """
    document = read_json(path, {}) or {}
    proposals = document.get('proposals')
    if document.get('version') != 1 or not isinstance(proposals, list) or not 1 <= len(proposals) <= 1024:
        raise ValueError('invalid-offline-review-preview')
    if target is None and ((document.get('rehearsal') or {}).get('matchedFiles') != len(proposals)
                           or document.get('acceptedIdentityConflicts')):
        raise ValueError('missing-multi-target-apply-rehearsal')
    approved = []
    seen = set()
    with sqlite3.connect('file:' + str(DATA / 'archive-pipeline.sqlite3') + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute('BEGIN')
        for item in proposals:
            ident = item.get('id')
            if type(ident) is not int or ident in seen or not isinstance(item.get('record'), dict):
                raise ValueError('invalid-offline-review-file')
            selected_target = target if target is not None else item.get('targetKey')
            if not isinstance(selected_target, str) or not selected_target:
                raise ValueError('invalid-offline-review-target')
            seen.add(ident)
            row = db.execute("SELECT * FROM files WHERE id=? AND state='copied' AND anime_key IS NULL", (ident,)).fetchone()
            if (not row or hashlib.sha256(row['record'].encode()).hexdigest() != item.get('originalSha256')
                    or not row['document_id'] or not row['destination_id']):
                raise ValueError('offline-review-source-changed')
            approved.append({**item, 'documentId': str(row['document_id']),
                             'destinationId': row['destination_id'], 'targetKey': selected_target})
    atomic_write_json(output, {'version': 1, 'applyBeforeConnect': True, 'reviewedAt': now_iso(),
        'reviewedPreviewSha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
        'liveDatabaseChanged': False, 'proposals': approved})
    print('OFFLINE_REVIEW_GUARDED_FOR_SOLE_WRITER', len(approved), target or 'rehearsed-per-file-targets', flush=True)


def binding_preview(output, titles, video_metadata=False, recoverable=False):
    """One disk-backed rehearsal for a complete reviewed multi-title batch."""
    from archive_identity import filename_candidate, caption_candidate, filename_web_candidate, make_plan, apply_plan, enrich_reviewed_pages
    with tempfile.TemporaryDirectory(prefix='archive-bulk-bind-', dir='/tmp/opencode') as scratch:
        db = sqlite3.connect(Path(scratch) / 'rehearsal.sqlite3')
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA cache_size=-4096')
        source = sqlite3.connect('file:' + str(DATA / 'archive-pipeline.sqlite3') + '?mode=ro', uri=True)
        try:
            source.backup(db)
        finally:
            source.close()
        try:
            state = load_state()
            ready = {key: hashlib.sha256(json.dumps(item, sort_keys=True).encode()).digest()
                     for key, item in state.get('queue', {}).items() if item.get('status') == 'done' and item.get('url')}
            cache = read_json(DATA / 'archive-identity-cache.json', {}) or {}
            enriched = enrich_reviewed_pages(state, cache)
            if video_metadata or recoverable:
                from archive_video_probe import verified_video_proposals
                video = verified_video_proposals(db)
                rows = [row for row in db.execute("SELECT * FROM files WHERE state='copied' AND anime_key IS NULL ORDER BY id")
                        if recoverable or row['id'] in video]
            else:
                video = {}
                rows = list(db.execute("SELECT * FROM files WHERE state='copied' AND anime_key IS NULL AND json_extract(record,'$.title') IN ("
                                       + ','.join('?' for _ in titles) + ') ORDER BY id', titles))
            originals, proposed = {}, {}
            reference_index = {}
            for row in rows:
                old = json.loads(row['record'])
                candidate = (video.get(row['id']) or filename_candidate(old, row['id']) or caption_candidate(old, row['id'])
                             or filename_web_candidate(old, row['id'], cache, reference_index) or old)
                if recoverable and candidate == old:
                    continue
                originals[row['id']] = row
                proposed[row['id']] = candidate
                if candidate != old:
                    db.execute('UPDATE files SET record=? WHERE id=?', (json.dumps(candidate, ensure_ascii=False), row['id']))
            db.commit()
            plan = make_plan(db, state, cache, 10000, only_titles={record['title'] for record in proposed.values()})
            conflicts = []
            for entry in plan['entries']:
                selected = []
                for ident in entry['fileIds']:
                    if ident not in originals:
                        continue
                    accepted = state.get('queue', {}).get('archive:' + str(ident), {})
                    if accepted.get('status') == 'done' and accepted.get('animeKey') not in (None, entry['key']):
                        conflicts.append(ident)
                    else:
                        selected.append(ident)
                entry['fileIds'] = selected
            plan['entries'] = [entry for entry in plan['entries'] if entry['fileIds']]
            result = apply_plan(state, db, plan)
            if enriched:
                result['metadataPagesEnriched'] = result.get('metadataPagesEnriched', 0) + enriched
            assert all(hashlib.sha256(json.dumps(state['queue'][key], sort_keys=True).encode()).digest() == digest
                       for key, digest in ready.items()), 'Existing accepted download changed during rehearsal'
            proposals = []
            counts = {}
            for ident, row in originals.items():
                target = db.execute('SELECT anime_key FROM files WHERE id=?', (ident,)).fetchone()[0]
                if not target:
                    continue
                counts[target] = counts.get(target, 0) + 1
                proposals.append({'id': ident, 'originalSha256': hashlib.sha256(row['record'].encode()).hexdigest(),
                    'record': proposed[ident], 'documentId': str(row['document_id']),
                    'destinationId': row['destination_id'], 'targetKey': target})
            assert len(proposals) == result.get('matchedFiles', 0)
            report = {'version': 1, 'generatedAt': now_iso(), 'liveDatabaseChanged': False,
                      'reviewedTitles': titles, 'videoMetadata': video_metadata, 'recoverableOnly': recoverable,
                      'reviewedFiles': len(originals), 'scannedFiles': len(rows), 'rehearsal': result,
                      'acceptedByTarget': counts, 'heldIds': sorted(set(originals) - {p['id'] for p in proposals}),
                      'acceptedIdentityConflicts': conflicts, 'proposals': proposals}
            atomic_write_json(output, report)
            print('BULK_ACTUAL_APPLY_REHEARSAL', json.dumps({key: value for key, value in report.items()
                  if key not in {'proposals', 'heldIds'}}, ensure_ascii=False), flush=True)
        finally:
            db.close()


def preview(output=None, file_ids=None):
    source = sqlite3.connect('file:' + str(DATA / 'archive-pipeline.sqlite3') + '?mode=ro', uri=True)
    scratch = tempfile.TemporaryDirectory(prefix='archive-preview-', dir='/tmp/opencode')
    memory = sqlite3.connect(Path(scratch.name) / 'preview.sqlite3')
    memory.execute('PRAGMA cache_size=-4096')
    memory.row_factory = sqlite3.Row
    try:
        source.backup(memory)
        source.close()
        originals = {row['id']: row['record'] for row in memory.execute("SELECT id,record FROM files WHERE state='copied' AND anime_key IS NULL")}
        state = load_state()
        cache = read_json(DATA / 'archive-identity-cache.json', {}) or {}
        recovered = recover_filename_records(memory, state, cache, limit=10000, file_ids=file_ids)
        proposals = []
        for row in memory.execute("SELECT id,record FROM files WHERE state='copied' AND anime_key IS NULL"):
            old = originals.get(row['id'])
            if old is not None and old != row['record']:
                proposals.append({'id': row['id'], 'originalSha256': hashlib.sha256(old.encode()).hexdigest(), 'record': json.loads(row['record'])})
        assert len(proposals) == recovered
        document = {'version': 1, 'generatedAt': now_iso(), 'liveDatabaseChanged': False, 'proposals': proposals}
        atomic_write_json(output or DATA / 'archive-full-match/filename-recovery-proposals.json', document)
        print('CERTIFIED_FILENAME_RECOVERY_PREVIEW', len(proposals), flush=True)
    finally:
        source.close()
        memory.close()
        scratch.cleanup()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Use a separate preview file instead of handing proposals to the live writer')
    parser.add_argument('--ids', help='Restrict review to these comma-separated archive IDs')
    parser.add_argument('--approve-offline-preview', type=Path, help='Record approval of a separately rehearsed preview; does not apply it')
    parser.add_argument('--target', help='Exact rehearsed target key for the approved preview')
    parser.add_argument('--binding-title', action='append', help='Rehearse all unmatched files of this reviewed literal title; repeat for a batch')
    parser.add_argument('--binding-video-metadata', action='store_true', help='Actually rehearse hash-guarded video-metadata candidates, not only planning')
    parser.add_argument('--binding-recoverable', action='store_true', help='Scan every unmatched copy and actually rehearse existing guarded filename/caption/video recoveries')
    args = parser.parse_args()
    if args.binding_title or args.binding_video_metadata or args.binding_recoverable:
        if not args.output or args.ids or args.approve_offline_preview:
            parser.error('Binding rehearsal requires --output and cannot combine with other modes')
        binding_preview(args.output, list(dict.fromkeys(args.binding_title or [])), args.binding_video_metadata, args.binding_recoverable)
    elif args.approve_offline_preview:
        if not args.output or args.ids:
            parser.error('Offline approval requires --output, without --ids; omit --target only for rehearsed multi-target previews')
        approve_offline_preview(args.approve_offline_preview, args.output, args.target)
    else:
        ids = {int(value) for value in args.ids.split(',')} if args.ids else None
        preview(args.output, ids)
