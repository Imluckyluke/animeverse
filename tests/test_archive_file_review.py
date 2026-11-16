import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from archive_file_review import fingerprint, reviewed_queue_allowed, reviewed_record_allowed
from archive_pipeline import open_db, publish_record, store_record
from catalog import build_catalog, build_links
from backfill import _season_compatible_record
from repair_availability import reconcile


class FileReviewTests(unittest.TestCase):
    def setUp(self):
        self.record = {'id': 1, 'name': 'Example III - 01 [720p].mkv', 'caption': '',
                       'title': 'Example III', 'episode': 1, 'quality': '720p', 'date': '2026-08-14'}
        self.anime = {'slug': 'example-iii', 'titleEn': 'Example III', 'episodes': {'1': {'720p': 'legacy'}},
                      'archiveFileReview': {'version': 1, 'files': {'1': {'sha256': fingerprint(self.record),
                         'documentId': 'doc1', 'destinationId': 101}}}}

    def test_only_exact_reviewed_source_revision_is_allowed(self):
        self.assertTrue(reviewed_record_allowed(self.anime, self.record, 'doc1'))
        self.assertFalse(reviewed_record_allowed(self.anime, {**self.record, 'name': 'Example II - 01 [720p].mkv'}, 'doc1'))
        self.assertFalse(reviewed_record_allowed(self.anime, self.record, 'changed-document'))
        self.assertFalse(reviewed_record_allowed(self.anime, {**self.record, 'id': 2}))
        self.assertFalse(_season_compatible_record(self.anime, 'Example III', {**self.record, 'id': 2}))
        self.assertTrue(reviewed_record_allowed({'titleEn': 'Unchanged Page'}, self.record))

    def test_old_accepted_queue_record_is_retained_but_never_exported(self):
        state = {'anime': {'a': copy.deepcopy(self.anime)}, 'queue': {'legacy': {'status': 'done', 'url': 'https://t.me/testanivers/99'}}}
        before = copy.deepcopy(state)
        self.assertEqual(build_catalog(state), [])
        self.assertEqual(build_links(state), {})
        self.assertEqual(state, before)
        with tempfile.TemporaryDirectory() as temp:
            db = open_db(Path(temp) / 'files.sqlite3')
            store_record(db, self.record, document_id='doc1')
            db.execute("UPDATE files SET anime_key='a',state='copied',destination_id=101 WHERE id=1")
            self.assertTrue(publish_record(state, db.execute('SELECT * FROM files').fetchone()))
            self.assertEqual(state['queue']['legacy'], before['queue']['legacy'])
            self.assertEqual(build_catalog(state)[0]['episodeData'][0]['qualities'][0]['url'], 'https://t.me/testanivers/101')
            self.assertEqual(len(build_links(state)), 1)
            db.close()

    def test_malformed_review_fails_closed_and_repeated_publication_is_idempotent(self):
        self.assertFalse(reviewed_queue_allowed({'archiveFileReview': []}, {}))
        queued = {'source': 'archive', 'archiveRecordId': 1, 'deepLink': 'archive:1', 'messageId': 101}
        self.assertTrue(reviewed_queue_allowed(self.anime, queued))
        self.assertFalse(reviewed_queue_allowed(self.anime, {**queued, 'messageId': 99}))

    def test_reviewed_file_does_not_require_a_blanket_conflicting_title_binding(self):
        with tempfile.TemporaryDirectory() as temp:
            db = open_db(Path(temp) / 'files.sqlite3')
            certified = {**self.record, 'identityReview': {'targetKey': 'a', 'providerId': 123}}
            store_record(db, certified, document_id='doc1')
            db.execute("UPDATE files SET anime_key='a',state='copied',destination_id=101 WHERE id=1")
            db.execute("INSERT INTO bindings VALUES('Example III',NULL,1)")
            state = {'anime': {'a': copy.deepcopy(self.anime)}, 'queue': {}}
            report = reconcile(state, db, publish_record)
            self.assertEqual(report['reconnectedLinks'], 1)
            self.assertEqual(db.execute("SELECT conflict FROM bindings WHERE title='Example III'").fetchone()[0], 1)
            state['anime']['a'].pop('archiveFileReview')
            self.assertFalse(publish_record(state, db.execute('SELECT * FROM files').fetchone()))
            db.close()


if __name__ == '__main__':
    unittest.main()
