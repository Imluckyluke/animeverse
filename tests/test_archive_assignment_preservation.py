import copy
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from archive_assignment_preservation import job_hash, restore_snapshot_assignments
from archive_file_review import fingerprint
from archive_pipeline import open_db, store_record


class AssignmentPreservationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.backups = self.root / 'backups'
        directory = self.backups / 'archive-test'
        directory.mkdir(parents=True)
        self.db = open_db(self.root / 'live.sqlite3')
        self.record = {'id': 1, 'title': 'Example S2', 'name': 'Example S2 - 02 [720p].mkv',
                       'episode': 2, 'quality': '720p', 'size': 100}
        store_record(self.db, self.record, document_id='111')
        self.db.execute("UPDATE files SET state='copied',destination_id=100,anime_key='verified',published=1")
        self.db.commit()
        self.snapshot = directory / 'archive-pipeline.sqlite3'
        with sqlite3.connect(self.snapshot) as target:
            self.db.backup(target)
        self.db.execute("UPDATE files SET anime_key='later-post'")
        self.state = {'anime': {
            'verified': {'metadataProviderId': 123, 'metadataSource': 'anilist', 'year': 2020,
                         'format': 'TV', 'declaredEpisodes': 12, 'verifiedArchiveTitles': ['Example S2'],
                         'titleEn': 'Example S2', 'slug': 'example-s2'},
            'later-post': {'titleEn': 'Example 2', 'slug': 'example-2'}},
            'queue': {'old': {'status': 'done', 'url': 'https://example.com/existing', 'animeKey': 'verified'}}}
        self.cache = {'Example S2': {'complete': True, 'media': [
            {'id': 123, 'title': {'romaji': 'Example S2'}, 'format': 'TV', 'status': 'FINISHED',
             'episodes': 12, 'startDate': {'year': 2020}}]}}
        self.proposal = {'version': 1, 'snapshotName': 'archive-test',
                         'snapshotSha256': hashlib.sha256(self.snapshot.read_bytes()).hexdigest(),
                         'changes': [{'id': 1, 'expectedCurrentKey': 'later-post', 'restoreKey': 'verified',
                                      'providerId': 123, 'recordSha256': hashlib.sha256(
                                          self.db.execute('SELECT record FROM files').fetchone()[0].encode()).hexdigest()}]}

    def tearDown(self):
        self.db.close()
        self.temporary.cleanup()

    def restore(self, proposal=None):
        return restore_snapshot_assignments(self.state, self.db, self.cache,
                                            self.proposal if proposal is None else proposal, self.backups)

    def assert_held(self):
        self.assertEqual(self.restore(), {'restoredAssignments': 0, 'heldAssignmentRestorations': 1})
        self.assertEqual(self.db.execute('SELECT anime_key FROM files').fetchone()[0], 'later-post')

    def test_restores_only_the_snapshot_assignment_and_is_idempotent(self):
        state_before = copy.deepcopy(self.state)
        row_before = dict(self.db.execute('SELECT * FROM files').fetchone())
        self.assertEqual(self.restore(), {'restoredAssignments': 1, 'heldAssignmentRestorations': 0})
        row_after = dict(self.db.execute('SELECT * FROM files').fetchone())
        self.assertEqual(row_after, {**row_before, 'anime_key': 'verified', 'published': 0})
        self.assertEqual(self.state, state_before, 'Never move pages, downloads or historical events')
        self.assertEqual(self.restore(), {'restoredAssignments': 0, 'heldAssignmentRestorations': 0})

    def test_missing_or_changed_snapshot_never_supplies_restoration_proof(self):
        for field, value in [('snapshotName', '../archive-test'), ('snapshotName', 'missing'),
                             ('snapshotSha256', 'wrong')]:
            with self.subTest(field=field, value=value):
                proposal = {**self.proposal, field: value}
                self.assertEqual(self.restore(proposal)['restoredAssignments'], 0)
        self.snapshot.unlink()
        self.assert_held()

    def test_live_source_document_destination_and_copy_state_must_be_unchanged(self):
        for field, value in [('record', json.dumps({**self.record, 'episode': 3})),
                             ('document_id', '222'), ('destination_id', 101), ('state', 'pending')]:
            with self.subTest(field=field):
                before = self.db.execute(f'SELECT {field} FROM files').fetchone()[0]
                self.db.execute(f'UPDATE files SET {field}=?', (value,))
                self.assert_held()
                self.db.execute(f'UPDATE files SET {field}=?', (before,))

    def test_a_different_current_assignment_is_never_overwritten(self):
        self.db.execute("UPDATE files SET anime_key='independently-changed'")
        self.assertEqual(self.restore()['restoredAssignments'], 0)
        self.assertEqual(self.db.execute('SELECT anime_key FROM files').fetchone()[0], 'independently-changed')

    def test_target_provider_year_format_and_total_must_still_be_certified(self):
        for field, value in [('metadataProviderId', 456), ('year', 2021), ('format', 'ONA'), ('declaredEpisodes', 13)]:
            with self.subTest(field=field):
                before = self.state['anime']['verified'][field]
                self.state['anime']['verified'][field] = value
                self.assert_held()
                self.state['anime']['verified'][field] = before
        self.state['anime']['later-post']['metadataProviderId'] = 456
        self.assert_held()

    def test_reviewed_target_document_constraints_remain_active(self):
        self.state['anime']['verified']['archiveFileReview'] = {'version': 1, 'files': {
            '1': {'sha256': fingerprint(self.record), 'documentId': 'other-document'}}}
        self.assert_held()

    def test_target_key_and_source_fingerprint_cannot_be_supplied_by_the_proposal_alone(self):
        for change in [{'restoreKey': 'unproved'}, {'recordSha256': 'wrong'}, {'providerId': 456}]:
            with self.subTest(change=change):
                proposal = {**self.proposal, 'changes': [{**self.proposal['changes'][0], **change}]}
                self.assertEqual(self.restore(proposal)['restoredAssignments'], 0)

    def test_first_episode_uses_the_snapshots_certified_series_not_an_invented_singleton(self):
        record = {**self.record, 'episode': 1, 'name': 'Example S2 - 01 [720p].mkv'}
        raw = json.dumps(record, ensure_ascii=False)
        with sqlite3.connect(self.snapshot) as snapshot:
            snapshot.execute('UPDATE files SET record=? WHERE id=1', (raw,))
        self.db.execute('UPDATE files SET record=? WHERE id=1', (raw,))
        self.proposal['changes'][0]['recordSha256'] = hashlib.sha256(raw.encode()).hexdigest()
        self.proposal['snapshotSha256'] = hashlib.sha256(self.snapshot.read_bytes()).hexdigest()
        self.assert_held()
        with sqlite3.connect(self.snapshot) as snapshot:
            snapshot.execute("INSERT INTO files(id,record,state,anime_key,destination_id,document_id) VALUES (2,?,'copied','verified',101,'222')",
                             (json.dumps({**self.record, 'id': 2}),))
        self.proposal['snapshotSha256'] = hashlib.sha256(self.snapshot.read_bytes()).hexdigest()
        self.assertEqual(self.restore()['restoredAssignments'], 1)

    def download_proposal(self):
        original = {'deepLink': 'archive:1', 'animeKey': 'verified', 'slug': 'example-s2',
                    'postId': 0, 'episode': 2, 'quality': '720p', 'status': 'done',
                    'source': 'archive', 'archiveRecordId': 1, 'messageId': 100,
                    'url': 'https://t.me/testanivers/100', 'size': 100}
        current = {**original, 'animeKey': 'later-post', 'slug': 'example-2', 'postId': 999}
        self.state['queue']['archive:1'] = current
        self.state['anime']['verified']['episodes'] = {'2': {'720p': 'archive:1'}}
        self.state['anime']['later-post']['episodes'] = {'2': {'720p': 'archive:1'}}
        snapshot = copy.deepcopy(self.state)
        snapshot['queue']['archive:1'] = original
        state_path = self.snapshot.with_name('aniplus-state.json')
        state_path.write_text(json.dumps(snapshot))
        self.proposal['snapshotStateSha256'] = hashlib.sha256(state_path.read_bytes()).hexdigest()
        self.proposal['changes'][0].update(restoreDownload=True, originalDownloadSha256=job_hash(original),
                                           expectedCurrentDownloadSha256=job_hash(current))
        return original

    def test_exact_snapshot_download_and_only_its_erroneous_pointer_are_restored(self):
        original = self.download_proposal()
        unrelated = copy.deepcopy(self.state['queue']['old'])
        result = self.restore()
        self.assertEqual(result, {'restoredAssignments': 1, 'restoredDownloads': 1, 'heldAssignmentRestorations': 0})
        self.assertEqual(self.state['queue']['archive:1'], original)
        self.assertEqual(self.state['queue']['old'], unrelated)
        self.assertEqual(self.state['anime']['later-post']['episodes']['2'], {})
        self.assertEqual(self.state['anime']['verified']['episodes']['2']['720p'], 'archive:1')
        self.assertIn('later-post', self.state['anime'], 'Never delete the later page')
        self.assertEqual(self.restore(), {'restoredAssignments': 0, 'heldAssignmentRestorations': 0})

    def test_download_restore_can_finish_after_file_assignment_was_already_recovered(self):
        original = self.download_proposal()
        self.db.execute("UPDATE files SET anime_key='verified'")
        result = self.restore()
        self.assertEqual(result['restoredAssignments'], 0)
        self.assertEqual(result['restoredDownloads'], 1)
        self.assertEqual(self.state['queue']['archive:1'], original)

    def test_download_restoration_never_overwrites_a_changed_url_quality_or_accepted_slot(self):
        self.download_proposal()
        for field, value in [('url', 'https://example.com/new'), ('quality', '1080p'), ('status', 'retry')]:
            with self.subTest(field=field):
                before = self.state['queue']['archive:1'][field]
                self.state['queue']['archive:1'][field] = value
                self.proposal['changes'][0]['expectedCurrentDownloadSha256'] = job_hash(self.state['queue']['archive:1'])
                self.assert_held()
                self.state['queue']['archive:1'][field] = before
        self.proposal['changes'][0]['expectedCurrentDownloadSha256'] = job_hash(self.state['queue']['archive:1'])
        self.state['anime']['verified']['episodes']['2']['720p'] = 'different-accepted-job'
        self.assert_held()

    def test_download_restore_requires_both_snapshot_and_current_job_hashes(self):
        self.download_proposal()
        before = copy.deepcopy(self.state)
        self.proposal['changes'][0]['expectedCurrentDownloadSha256'] = 'wrong'
        self.assert_held()
        self.assertEqual(self.state, before)
        self.proposal['changes'][0]['expectedCurrentDownloadSha256'] = job_hash(self.state['queue']['archive:1'])
        self.proposal['snapshotStateSha256'] = 'wrong'
        self.assert_held()


if __name__ == '__main__':
    unittest.main()
