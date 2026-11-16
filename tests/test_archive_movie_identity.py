import sys
import json
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from archive_identity import apply_plan, choose_identity, compatible_record, make_plan, safe_movie_record
from archive_pipeline import open_db, store_record
from common import DEST_USERNAME


def record(**changes):
    return {'id': 1, 'title': 'Example Movie', 'name': '[AWHT] Example Movie [720p].mkv',
            'quality': '720p', 'episode': None, **changes}


def media(**changes):
    return {'id': 123, 'title': {'romaji': 'Example Movie'}, 'synonyms': [], 'format': 'MOVIE',
            'episodes': 1, 'status': 'FINISHED', 'startDate': {'year': 2020}, **changes}


class ArchiveMovieIdentityTests(unittest.TestCase):
    def test_single_movie_keeps_source_episode_null(self):
        source = record()
        chosen, reason = choose_identity('Example Movie', [source], [media()])
        self.assertEqual(chosen['id'], 123)
        self.assertEqual(reason, 'unique-exact-single-movie-identity')
        anime = {'format': 'MOVIE', 'year': 2020, 'declaredEpisodes': 1, 'verifiedArchiveTitles': ['Example Movie']}
        self.assertTrue(compatible_record(anime, source))
        self.assertIsNone(source['episode'])

    def test_wrong_episode_split_or_filename_is_held(self):
        self.assertFalse(safe_movie_record(record(episode=2)))
        self.assertFalse(safe_movie_record(record(name='Example Movie CD1 [720p].mkv')))
        self.assertFalse(safe_movie_record(record(name='Another Movie [720p].mkv')))
        self.assertFalse(safe_movie_record(record(name='Example Movie - 01-02 [720p].mkv')))

    def test_competing_movie_or_tv_is_not_chosen(self):
        self.assertIsNone(choose_identity('Example Movie', [record()], [media(), media(id=456)])[0])
        self.assertIsNone(choose_identity('Example Movie', [record()], [media(), media(id=456, format='TV', episodes=12)])[0])

    def test_future_or_multi_episode_movie_is_held(self):
        self.assertIsNone(choose_identity('Example Movie', [record()], [media(status='NOT_YET_RELEASED')])[0])
        self.assertIsNone(choose_identity('Example Movie', [record()], [media(episodes=2)])[0])

    def test_movie_uses_existing_single_download_slot_without_rewriting_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = open_db(Path(temporary) / 'pipeline.sqlite3')
            store_record(database, record())
            database.execute("UPDATE files SET state='copied',destination_id=101 WHERE id=1")
            state = {'anime': {}, 'queue': {}}
            cache = {'Example Movie': {'complete': True, 'media': [media()]}}
            plan = make_plan(database, state, cache, 200)
            result = apply_plan(state, database, plan)
            self.assertEqual(result['matchedFiles'], 1)
            self.assertEqual(state['anime']['al123']['type'], 'فیلم')
            self.assertEqual(state['queue']['archive:1']['url'], f'https://t.me/{DEST_USERNAME}/101')
            self.assertEqual(state['queue']['archive:1']['episode'], 1)
            self.assertIsNone(json.loads(database.execute('SELECT record FROM files WHERE id=1').fetchone()[0])['episode'])
            database.close()


if __name__ == '__main__':
    unittest.main()
