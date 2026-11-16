from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
import admin_commands
from admin_service import prepare_review
from admin_store import AdminStore, hash_password
from archive_pipeline import open_db, store_record


class AdminCommandTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hashed = hash_password('test-owner-password-only')

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.data = self.root / 'data'
        self.data.mkdir()
        self.store = AdminStore(self.data / 'admin.sqlite3', 'owner@example.test', self.hashed)
        self.owner = self.store.accounts()['items'][0]['id']
        self.db = open_db(self.data / 'archive-pipeline.sqlite3')
        record = {'id': 10, 'title': 'Example', 'name': 'Example - 03 [720p].mkv', 'episode': 3, 'quality': '720p', 'size': 1000}
        store_record(self.db, record)
        self.db.execute("UPDATE files SET state='copied',destination_id=110 WHERE id=10")
        self.db.commit()
        self.state = {'anime': {'al123': {'key': 'al123', 'slug': 'example', 'titleEn': 'Example', 'titleOriginal': 'Example',
            'year': 2020, 'format': 'TV', 'type': 'سریال', 'declaredEpisodes': 12, 'metadataProviderId': 123,
            'metadataSource': 'anilist', 'verifiedArchiveTitles': ['Example'], 'episodes': {}}}, 'queue': {}}
        self.state_path = self.data / 'state.json'
        self.state_path.write_text(json.dumps(self.state))
        self.patches = [patch.object(admin_commands, 'DATA', self.data), patch.object(admin_commands, 'ROOT', self.root),
                        patch.object(admin_commands, 'STATE_PATH', self.state_path),
                        patch.object(admin_commands, 'save_state', lambda state: self.state_path.write_text(json.dumps(state))),
                        patch.object(admin_commands, 'write_catalog', lambda state: None)]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.db.close()
        self.store.close()
        self.folder.cleanup()

    def queue_match(self, replace=False, episode=3):
        row = self.db.execute('SELECT * FROM files WHERE id=10').fetchone()
        payload, errors, warnings = prepare_review(row, 'al123', self.state['anime']['al123'],
            {'fileId': 10, 'targetSlug': 'example', 'episode': episode, 'quality': '720p',
             'note': 'Reviewed exact filename and reference', 'replaceExisting': replace})
        return self.store.command(self.owner, 'review.match', payload)['commandId'], errors

    def test_only_writer_applies_and_undo_restores_source_without_changing_ids(self):
        before = self.db.execute('SELECT record FROM files WHERE id=10').fetchone()[0]
        ident, errors = self.queue_match()
        self.assertFalse(errors)
        self.assertIsNone(self.db.execute('SELECT anime_key FROM files WHERE id=10').fetchone()[0])
        self.assertTrue(admin_commands.consume_commands(self.state, self.db))
        self.assertEqual(self.store.get_command(ident)['state'], 'applied')
        self.assertEqual(self.db.execute('SELECT anime_key FROM files WHERE id=10').fetchone()[0], 'al123')
        self.assertEqual(self.state['anime']['al123']['episodes']['3']['720p'], 'archive:10')
        event = self.store.history()['items'][0]
        undo = self.store.command(self.owner, 'review.undo', {'eventId': event['id'], 'note': 'Restore the verified previous record'})['commandId']
        admin_commands.consume_commands(self.state, self.db)
        self.assertEqual(self.store.get_command(undo)['state'], 'applied')
        row = self.db.execute('SELECT * FROM files WHERE id=10').fetchone()
        self.assertEqual(row['record'], before)
        self.assertIsNone(row['anime_key'])
        self.assertEqual(row['destination_id'], 110)

    def test_stale_preview_and_unsafe_episode_never_bind(self):
        ident, _ = self.queue_match()
        changed = {'id': 10, 'title': 'Example', 'name': 'Example - 04 [720p].mkv', 'episode': 4, 'quality': '720p'}
        self.db.execute('UPDATE files SET record=? WHERE id=10', (json.dumps(changed),))
        self.db.commit()
        admin_commands.consume_commands(self.state, self.db)
        self.assertEqual(self.store.get_command(ident)['state'], 'failed')
        self.assertIsNone(self.db.execute('SELECT anime_key FROM files WHERE id=10').fetchone()[0])
        self.assertEqual(self.state['queue'], {})

    def test_explicit_replacement_preserves_old_queue_and_undo_restores_it(self):
        self.state['anime']['al123']['episodes'] = {'3': {'720p': 'old'}}
        original = {'status': 'done', 'url': 'https://t.me/testanivers/100', 'animeKey': 'al123'}
        self.state['queue']['old'] = deepcopy(original)
        ident, errors = self.queue_match(replace=True)
        self.assertFalse(errors)
        admin_commands.consume_commands(self.state, self.db)
        self.assertEqual(self.store.get_command(ident)['state'], 'applied')
        self.assertEqual(self.state['queue']['old'], original)
        event = self.store.history()['items'][0]
        self.store.command(self.owner, 'review.undo', {'eventId': event['id'], 'note': 'Restore the old ready source link'})
        admin_commands.consume_commands(self.state, self.db)
        self.assertEqual(self.state['anime']['al123']['episodes']['3']['720p'], 'old')
        self.assertEqual(self.state['queue']['old'], original)

    def test_interrupted_acknowledgment_is_idempotent(self):
        ident, _ = self.queue_match()
        admin_commands.consume_commands(self.state, self.db)
        total = self.store.history()['total']
        self.store.db.execute("UPDATE admin_commands SET state='running' WHERE id=?", (ident,))
        admin_commands.consume_commands(self.state, self.db)
        self.assertEqual(self.store.get_command(ident)['state'], 'applied')
        self.assertEqual(self.store.history()['total'], total)

    def test_publication_is_not_acknowledged_by_the_catalog_writer(self):
        ident = self.store.command(self.owner, 'publish', {})['commandId']
        admin_commands.consume_commands(self.state, self.db)
        self.assertEqual(self.store.get_command(ident)['state'], 'running')
        self.assertIn(ident, json.loads((self.data / 'admin-publish-request.json').read_text())['commands'])


if __name__ == '__main__':
    unittest.main()
