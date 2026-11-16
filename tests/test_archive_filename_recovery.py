import json
from pathlib import Path
import sqlite3
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from archive_identity import recover_filename_records


class FilenameRecoveryTests(unittest.TestCase):
    def test_only_certified_missing_parses_are_recovered(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.executescript('''CREATE TABLE files(id INTEGER PRIMARY KEY,record TEXT,state TEXT,
            anime_key TEXT,destination_id INTEGER,document_id TEXT); CREATE TABLE bindings(title TEXT,anime_key TEXT,conflict INTEGER);''')
        records = [
            {'id': 1, 'name': 'Example - 02 [720p].mkv', 'title': None},
            {'id': 2, 'name': 'Example - 03 [720p].mkv', 'title': 'Different'},
            {'id': 3, 'name': 'Unverified - 02 [720p].mkv', 'title': None},
            {'id': 4, 'name': 'Example - 04 [720p].mkv', 'title': None, 'episode': 9},
            {'id': 5, 'name': '[AWHT] Fairy Tail S1 - 02 [720p].mkv',
             'title': 'Fairy Tail', 'episode': 2, 'quality': '720p'},
        ]
        for record in records:
            db.execute('INSERT INTO files(id,record,state,anime_key,destination_id) VALUES(?,?,\'copied\',NULL,?)',
                       (record['id'], json.dumps(record), record['id'] + 100))
        db.commit()
        media = {'id': 123, 'title': {'romaji': 'Example'}, 'synonyms': [], 'format': 'TV',
                 'status': 'FINISHED', 'episodes': 12, 'startDate': {'year': 2020}}
        cache = {'Example': {'complete': True, 'media': [media]}}
        cache['Fairy Tail'] = {'complete': True, 'media': [{**media, 'id': 6702,
            'title': {'romaji': 'FAIRY TAIL'}, 'episodes': 175, 'startDate': {'year': 2009}}]}
        count = recover_filename_records(db, {'anime': {}}, cache)
        self.assertEqual(count, 2)
        updated = {row['id']: json.loads(row['record']) for row in db.execute('SELECT * FROM files')}
        self.assertEqual(updated[1]['title'], 'Example')
        self.assertEqual(updated[1]['episode'], 2)
        self.assertEqual(updated[5]['title'], 'Fairy Tail S1')
        for record in records[1:4]:
            self.assertEqual(updated[record['id']], record)
        self.assertTrue(all(row[0] is None for row in db.execute('SELECT anime_key FROM files')))
        db.close()


if __name__ == '__main__':
    unittest.main()
