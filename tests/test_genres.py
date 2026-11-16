import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/tg"))
from genres import normalize_genres
from catalog import build_catalog
from parse import parse_post


class GenreTests(unittest.TestCase):
    def test_shared_browser_worker_cases(self):
        for row in json.loads((ROOT / "tests/genre-cases.json").read_text()):
            with self.subTest(row=row):
                self.assertEqual(normalize_genres(row["input"]), row["expected"])
                self.assertEqual(normalize_genres(row["expected"]), row["expected"])

    def test_existing_catalogue_and_metadata_not_mutated(self):
        rows = json.loads((ROOT / "src/lib/real-catalog.json").read_text())
        before = copy.deepcopy(rows)
        names = {genre for row in rows for genre in normalize_genres(row.get("genres"))}
        # Matching another real title can add a legitimate genre. Do not make
        # catalogue growth fail a preservation test at an arbitrary count.
        self.assertTrue(names)
        self.assertNotIn("👥 اطلاعات تیم ترجمه :", names)
        self.assertFalse(any("#" in name or "_" in name for name in names))
        self.assertEqual(rows, before)

    def test_new_legitimate_combat_sports_genre_is_not_discarded_to_keep_inventory_small(self):
        values=['کمدی','شونن','ورزشی','ورزش های رزمی']
        self.assertEqual(normalize_genres(values),values)

    def test_catalogue_splits_before_limiting_and_keeps_all_real_genres(self):
        state = {"anime": {"one": {"slug": "one", "titleEn": "Test", "episodes": {"1": {"720p": "link"}}, "genres": [
            "#کمدی #شونن #مدرسه_ای #فانتزی #افسانه‌_ای #زندگی_کاری #شوخ_طبعی"]}}, "queue": {"link": {"status": "done", "url": "https://example.org/file"}}}
        before = copy.deepcopy(state)
        self.assertEqual(len(build_catalog(state)[0]["genres"]), 7)
        self.assertEqual(state, before)

    def test_new_posts_are_normalized_at_ingestion(self):
        text = "[🎥](https://example.org/cover.jpg) Test\n📖 اطلاعات تکمیلی\nژانرها: #فانتزی #اکشن #علمی_تخیلی\n📥 لینک های دانلود:\nقسمت 1: [720p](https://t.me/AniPlusMiniBot?start=get_test)\n"
        result = parse_post(123, text, None)
        self.assertIsNotNone(result)
        self.assertEqual(result["genres"], ["فانتزی", "اکشن", "علمی-تخیلی"])


if __name__ == "__main__":
    unittest.main()
