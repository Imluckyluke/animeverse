import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "tg"))
from archive_pipeline import bind_title, open_db, publish_record, random_id, setting, set_setting, store_record
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

    def test_foreign_or_malformed_links_do_not_crash_verification(self):
        self.assertEqual(message_number("https://t.me/testanivers/4622"), 4622)
        self.assertEqual(message_number("https://example.com/file.mkv"), 0)
        self.assertEqual(message_number(None), 0)


if __name__ == "__main__":
    unittest.main()
