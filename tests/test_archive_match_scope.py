import json
from pathlib import Path
import sqlite3
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from archive_identity import make_plan


class ArchiveMatchScopeTests(unittest.TestCase):
    def test_high_volume_held_titles_do_not_starve_later_certified_titles(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.executescript('''CREATE TABLE files(id INTEGER PRIMARY KEY,record TEXT,state TEXT,
            anime_key TEXT,destination_id INTEGER); CREATE TABLE bindings(title TEXT,anime_key TEXT,conflict INTEGER);''')
        for ident, title, episode in [(i, 'Blocked', 50) for i in range(1, 6)] + [(9, 'Ready', 2), (10, 'Other', 2)]:
            record = {'id': ident, 'title': title, 'name': f'{title} - {episode:02} [720p].mkv', 'episode': episode, 'quality': '720p'}
            db.execute("INSERT INTO files VALUES(?,?,'copied',NULL,?)", (ident, json.dumps(record), ident + 100))
        cache = {title: {'complete': True, 'media': [{'id': provider, 'title': {'romaji': title}, 'synonyms': [],
            'format': 'TV', 'episodes': 12, 'status': 'FINISHED', 'startDate': {'year': 2020}}]}
            for title, provider in [('Blocked', 11), ('Ready', 22), ('Other', 33)]}
        plan = make_plan(db, {'anime': {}}, cache, limit=1)
        self.assertEqual(len(plan['entries']), 1)
        self.assertNotEqual(plan['entries'][0]['archiveTitle'], 'Blocked')
        self.assertEqual(plan['scannedTitles'], 3)
        self.assertTrue(all(row[0] is None for row in db.execute('SELECT anime_key FROM files')))
        db.close()


if __name__ == '__main__': unittest.main()
