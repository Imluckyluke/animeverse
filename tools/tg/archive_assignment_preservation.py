"""Restore a reviewed accidental remap from an immutable local snapshot.

Only the sole writer calls this consumer. This is not an identity discovery,
page merge, metadata rewrite or general-purpose reassignment interface.
"""
import hashlib
import json
from pathlib import Path
import sqlite3


def job_hash(job):
    return hashlib.sha256(json.dumps(job, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def restore_snapshot_assignments(state, db, cache, proposal, backups):
    from archive_identity import choose_identity, compatible_record, reference_lookup
    from archive_file_review import reviewed_record_allowed

    result = {'restoredAssignments': 0, 'heldAssignmentRestorations': 0}
    if not isinstance(proposal, dict):
        return result
    changes = proposal.get('changes', [])
    if proposal.get('version') != 1 or not isinstance(changes, list):
        return result
    pending = []
    for change in changes:
        if not isinstance(change, dict) or type(change.get('id')) is not int:
            result['heldAssignmentRestorations'] += 1
            continue
        row = db.execute('SELECT * FROM files WHERE id=?', (change['id'],)).fetchone()
        if row and row['anime_key'] == change.get('restoreKey'):
            if (not change.get('restoreDownload') or job_hash(state.get('queue', {}).get(f"archive:{change['id']}"))
                    == change.get('originalDownloadSha256')):
                continue
        if (not row or not change.get('expectedCurrentKey') or not change.get('restoreKey')
                or row['anime_key'] not in ({change['expectedCurrentKey'], change['restoreKey']}
                    if change.get('restoreDownload') else {change['expectedCurrentKey']})):
            result['heldAssignmentRestorations'] += 1
            continue
        pending.append((change, row))
    if not pending:
        return result
    name = proposal.get('snapshotName')
    root = Path(backups).resolve()
    if not isinstance(name, str) or Path(name).name != name or not name.startswith('archive-'):
        result['heldAssignmentRestorations'] += len(pending)
        return result
    snapshot = root / name / 'archive-pipeline.sqlite3'
    if not snapshot.is_file() or snapshot.resolve().parent.parent != root:
        result['heldAssignmentRestorations'] += len(pending)
        return result
    with snapshot.open('rb') as handle:
        if hashlib.file_digest(handle, 'sha256').hexdigest() != proposal.get('snapshotSha256'):
            result['heldAssignmentRestorations'] += len(pending)
            return result
    snapshot_state = None
    if any(change.get('restoreDownload') for change, _ in pending):
        state_path = snapshot.with_name('aniplus-state.json')
        if not state_path.is_file() or state_path.resolve().parent != snapshot.resolve().parent:
            result['heldAssignmentRestorations'] += len(pending)
            return result
        with state_path.open('rb') as handle:
            if hashlib.file_digest(handle, 'sha256').hexdigest() != proposal.get('snapshotStateSha256'):
                result['heldAssignmentRestorations'] += len(pending)
                return result
        snapshot_state = json.loads(state_path.read_text())
    original = sqlite3.connect(snapshot.resolve().as_uri() + '?mode=ro', uri=True)
    original.row_factory = sqlite3.Row
    pool = reference_lookup(cache)[0]
    certified_groups = {}
    try:
        for change, row in pending:
            before = original.execute('SELECT * FROM files WHERE id=?', (change['id'],)).fetchone()
            target = state.get('anime', {}).get(change['restoreKey'], {})
            current = state.get('anime', {}).get(change['expectedCurrentKey'], {})
            provider = change.get('providerId')
            media = pool.get(provider) if type(provider) is int else None
            if (not before or before['anime_key'] != change['restoreKey']
                    or before['state'] != 'copied' or row['state'] != 'copied'
                    or not row['destination_id'] or not row['document_id']
                    or any(before[field] != row[field] for field in ('record', 'document_id', 'destination_id'))
                    or hashlib.sha256(row['record'].encode()).hexdigest() != change.get('recordSha256')
                    or not media or target.get('metadataProviderId') != provider
                    or current.get('metadataProviderId') not in (None, provider)
                    or target.get('year') != (media.get('startDate') or {}).get('year')
                    or type(target.get('year')) is not int
                    or target.get('format') != media.get('format')
                    or type(media.get('episodes')) is not int or media['episodes'] < 1
                    or target.get('declaredEpisodes') != media['episodes']):
                result['heldAssignmentRestorations'] += 1
                continue
            record = json.loads(row['record'])
            group = (change['restoreKey'], record.get('title'))
            if group not in certified_groups:
                # A first episode is restored as part of its historically
                # certified series, not promoted from singleton numbering.
                records = [json.loads(peer[0]) for peer in original.execute(
                    "SELECT record FROM files WHERE state='copied' AND anime_key=? AND json_extract(record,'$.title')=?",
                    group)]
                certified_groups[group] = choose_identity(record.get('title'), records, [media])[0]
            chosen = certified_groups[group]
            if (not chosen or not compatible_record(target, record)
                    or not reviewed_record_allowed(target, record, row['document_id'])):
                result['heldAssignmentRestorations'] += 1
                continue
            deep = f"archive:{change['id']}"
            original_job = None
            if change.get('restoreDownload'):
                original_job = snapshot_state.get('queue', {}).get(deep)
                current_job = state.get('queue', {}).get(deep)
                if (not original_job or not current_job or original_job.get('status') != 'done'
                        or not original_job.get('url') or original_job.get('animeKey') != change['restoreKey']
                        or original_job.get('archiveRecordId') != change['id']
                        or original_job.get('episode') != record.get('episode')
                        or original_job.get('quality') != record.get('quality')
                        or original_job.get('slug') != target.get('slug')
                        or job_hash(original_job) != change.get('originalDownloadSha256')
                        or job_hash(current_job) != change.get('expectedCurrentDownloadSha256')
                        or any(original_job.get(field) != current_job.get(field)
                               for field in original_job.keys() | current_job.keys()
                               if field not in {'animeKey', 'slug', 'postId'})
                        or target.get('episodes', {}).get(str(record['episode']), {}).get(record['quality']) != deep):
                    result['heldAssignmentRestorations'] += 1
                    continue
            if row['anime_key'] != change['restoreKey']:
                updated = db.execute('UPDATE files SET anime_key=?,published=0 WHERE id=? AND anime_key=? AND record=?',
                                     (change['restoreKey'], change['id'], change['expectedCurrentKey'], row['record']))
                if not updated.rowcount:
                    result['heldAssignmentRestorations'] += 1
                    continue
                result['restoredAssignments'] += updated.rowcount
            if original_job is not None:
                state['queue'][deep] = dict(original_job)
                bucket = current.get('episodes', {}).get(str(record['episode']), {})
                if bucket.get(record['quality']) == deep:
                    del bucket[record['quality']]
                result['restoredDownloads'] = result.get('restoredDownloads', 0) + 1
    finally:
        original.close()
    return result
