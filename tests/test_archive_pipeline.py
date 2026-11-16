import json
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "tg"))
from archive_pipeline import Pipeline, bind_title, open_db, publish_record, random_id, setting, set_setting, store_record
from publish_catalog import content_digest, message_number


class DurableArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "queue.sqlite3"
        self.db = open_db(self.path)

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_source_upsert_preserves_completed_copy(self):
        record = {"id": 10, "title": "Title S2", "episode": 3, "quality": "1080p"}
        store_record(self.db, record)
        self.db.execute("UPDATE files SET state='copied',destination_id=100,random_id=123 WHERE id=10")
        store_record(self.db, {**record, "name": "updated filename"}, 1, "456")
        row = self.db.execute("SELECT * FROM files WHERE id=10").fetchone()
        self.assertEqual(row["state"], "copied")
        self.assertEqual(row["destination_id"], 100)
        self.assertEqual(row["random_id"], 123)
        self.assertEqual(row["priority"], 1)

    def test_source_upsert_never_replaces_a_previously_certified_assignment(self):
        record = {'id': 10, 'title': 'Shared title S5', 'episode': 1, 'quality': '720p'}
        store_record(self.db, record)
        self.db.execute("UPDATE files SET anime_key='certified',published=1 WHERE id=10")
        bind_title(self.db, record['title'], 'new-post-page')
        store_record(self.db, record)
        row = self.db.execute('SELECT anime_key,published FROM files WHERE id=10').fetchone()
        self.assertEqual(tuple(row), ('certified', 1))
        store_record(self.db, {**record, 'id': 11})
        self.assertEqual(self.db.execute('SELECT anime_key FROM files WHERE id=11').fetchone()[0], 'new-post-page')

    def test_later_post_matching_fills_only_unassigned_files(self):
        records = [{'id': ident, 'title': 'Shared title S5', 'episode': 1, 'quality': '720p'} for ident in [10, 11]]
        for record in records:
            store_record(self.db, record)
        self.db.execute("UPDATE files SET anime_key='certified',published=1 WHERE id=10")
        self.db.execute("INSERT INTO posts VALUES (100,?,0)", (json.dumps({'postId': 100}),))
        pipeline = Pipeline.__new__(Pipeline)
        pipeline.db, pipeline.state = self.db, {'anime': {}}
        pipeline.grouped, pipeline.metadata, pipeline.bot_enabled = {}, {}, False
        pipeline.dirty, pipeline.cover_keys = False, set()
        with patch('archive_pipeline.match_archive', return_value=records), \
             patch('archive_pipeline.select_archive_title_records', return_value=records), \
             patch('archive_pipeline.group_key', return_value='new-post-page'), \
             patch('archive_pipeline.merge_post', return_value=('new-post-page', False, False, [])):
            pipeline.match_posts()
        self.assertEqual(tuple(self.db.execute('SELECT anime_key,published FROM files WHERE id=10').fetchone()), ('certified', 1))
        self.assertEqual(self.db.execute('SELECT anime_key FROM files WHERE id=11').fetchone()[0], 'new-post-page')

    def test_send_random_id_is_stable_and_destination_specific(self):
        value = random_id(1, 2, 3)
        self.assertEqual(value, random_id(1, 2, 3))
        self.assertNotEqual(value, random_id(1, 4, 3))
        self.assertGreater(value, 0)
        self.assertLess(value, 2 ** 63)

    def test_cursor_and_source_rows_survive_restart(self):
        store_record(self.db, {"id": 300, "name": "subtitle.zip"})
        set_setting(self.db, "sky_live", 300)
        self.db.commit()
        self.db.close()
        self.db = open_db(self.path)
        self.assertEqual(setting(self.db, "sky_live"), 300)
        self.assertEqual(self.db.execute("SELECT count(*) FROM files").fetchone()[0], 1)

    def test_conflicting_title_is_not_rebound(self):
        self.assertTrue(bind_title(self.db, "Shared title", "season-1"))
        self.assertFalse(bind_title(self.db, "Shared title", "season-2"))
        self.assertFalse(bind_title(self.db, "Shared title", "season-1"))
        store_record(self.db, {"id": 12, "title": "Shared title"})
        self.assertIsNone(self.db.execute("SELECT anime_key FROM files").fetchone()[0])

    def copied_row(self, episode=3, key="a1"):
        record = {"id": 10, "title": "Title", "episode": episode, "quality": "1080p", "size": 100}
        store_record(self.db, record)
        self.db.execute("UPDATE files SET state='copied',destination_id=100,anime_key=? WHERE id=10", (key,))
        return self.db.execute("SELECT * FROM files WHERE id=10").fetchone()

    def test_publish_is_idempotent_and_does_not_invent_release_dates(self):
        row = self.copied_row()
        state = {"anime": {"a1": {"slug": "title", "titleEn": "Title", "episodes": {}}}, "queue": {}}
        self.assertTrue(publish_record(state, row))
        self.assertFalse(publish_record(state, row))
        self.assertEqual(state["anime"]["a1"]["episodes"]["3"]["1080p"], "archive:10")
        self.assertEqual(state["queue"]["archive:10"]["messageId"], 100)
        self.assertNotIn("releasedAt", state["queue"]["archive:10"])

    def test_unmatched_files_are_not_published_under_a_guessed_title(self):
        row = self.copied_row(key="unknown")
        self.assertFalse(publish_record({"anime": {}, "queue": {}}, row))

    def test_a_later_page_cannot_overwrite_an_accepted_archive_download_identity(self):
        row = self.copied_row(key='later-post')
        accepted = {'status': 'done', 'url': 'https://t.me/testanivers/100', 'animeKey': 'certified',
                    'episode': 3, 'quality': '1080p', 'archiveRecordId': 10}
        state = {'anime': {'later-post': {'slug': 'later-post', 'titleEn': 'Title', 'episodes': {}}},
                 'queue': {'archive:10': dict(accepted)}}
        self.assertFalse(publish_record(state, row))
        self.assertEqual(state['queue']['archive:10'], accepted)
        self.assertEqual(state['anime']['later-post']['episodes'], {})

    def test_missing_episode_is_not_guessed_for_series(self):
        row = self.copied_row(episode=None)
        state = {"anime": {"a1": {"slug": "title", "type": "سریال", "episodes": {}}}, "queue": {}}
        self.assertFalse(publish_record(state, row))
        state["anime"]["a1"]["type"] = "فیلم"
        self.assertTrue(publish_record(state, row))

    def test_publisher_also_notices_artwork_and_banner_corrections(self):
        base = Path(self.temp.name)
        (base / "src/lib").mkdir(parents=True)
        (base / "src/lib/real-catalog.json").write_text("[]")
        before = content_digest(base)
        (base / "src/lib/generated-banners.json").write_text('{"title":"real banner"}')
        self.assertNotEqual(before, content_digest(base))
        before = content_digest(base)
        (base / "src/lib/generated-airing.json").write_text('{"entries":{"1":{"nextAiringEpisode":{"episode":2}}}}')
        self.assertNotEqual(before, content_digest(base), 'An airing schedule change must be published even without a new archive copy')

    def test_foreign_or_malformed_links_do_not_crash_verification(self):
        self.assertEqual(message_number("https://t.me/testanivers/4622"), 4622)
        self.assertEqual(message_number("https://example.com/file.mkv"), 0)
        self.assertEqual(message_number(None), 0)


if __name__ == "__main__":
    unittest.main()
