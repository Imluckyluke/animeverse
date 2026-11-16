import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from archive_identity import apply_plan, choose_identity, compatible_record, make_plan, safe_special_record
from archive_pipeline import open_db, store_record


def record(**changes):
    return {'id': 1, 'title': 'Example OVA', 'name': '[AWHT] Example OVA - 01 [720p].mkv',
            'quality': '720p', 'episode': 1, **changes}


def media(**changes):
    return {'id': 123, 'title': {'romaji': 'Example OVA'}, 'synonyms': [], 'format': 'OVA',
            'episodes': 2, 'status': 'FINISHED', 'startDate': {'year': 2020}, **changes}


class SpecialIdentityTests(unittest.TestCase):
    def test_unlabeled_ova_requires_a_complete_exact_provider_not_a_tv_parent(self):
        source = record(title='Distinct Work', name='Distinct Work (2020) - 02 [720p].mkv', episode=2)
        provider = media(title={'romaji': 'Distinct Work'}, episodes=6)
        self.assertFalse(safe_special_record(source, 6))
        self.assertTrue(safe_special_record(source, 6, provider))
        self.assertFalse(safe_special_record({**source, 'name': 'Distinct Work - 02 [720p].mkv'}, 6, provider),
                         'A bare title cannot distinguish an OVA from a differently suffixed TV adaptation')
        self.assertEqual(choose_identity('Distinct Work', [source], [provider])[0]['id'], 123)
        for changes in [{'format': 'TV'}, {'status': 'NOT_YET_RELEASED'}, {'episodes': 7}, {'title': {'romaji': 'A Different Work'}}]:
            self.assertFalse(safe_special_record(source, 6, {**provider, **changes}))
        self.assertIsNone(choose_identity('Distinct Work', [source], [provider, {**provider, 'id': 456, 'format': 'TV'}])[0])
        tv = {**provider, 'id': 456, 'format': 'TV', 'title': {'romaji': 'Distinct Work (TV)'}}
        self.assertIsNone(choose_identity('Distinct Work', [source], [provider, tv])[0],
                          'An explicit year does not distinguish two adaptations from that same year')
        self.assertEqual(choose_identity('Distinct Work', [source], [provider, {**tv, 'startDate': {'year': 2021}}])[0]['id'], 123)

    def test_provider_confirmed_filename_year_is_allowed_but_never_relabels_another_version(self):
        source = record(title='Distinct Work', name='Distinct Work (2020) - 02 [720p].mkv', episode=2)
        provider = media(title={'romaji': 'Distinct Work'}, episodes=6)
        self.assertTrue(safe_special_record(source, 6, provider))
        self.assertFalse(safe_special_record({**source, 'name': 'Distinct Work (2021) - 02 [720p].mkv'}, 6, provider))
        self.assertFalse(safe_special_record({**source, 'name': 'Distinct Work II (2020) - 02 [720p].mkv'}, 6, provider))

    def test_unlabeled_ova_publication_preserves_distinct_provider_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = open_db(Path(temporary) / 'pipeline.sqlite3')
            source = record(title='Distinct Work', name='Distinct Work (2020) - 02 [720p].mkv', episode=2)
            store_record(database, source)
            database.execute("UPDATE files SET state='copied',destination_id=101 WHERE id=1")
            state = {'anime': {}, 'queue': {}}
            provider = media(title={'romaji': 'Distinct Work'}, episodes=6)
            cache = {'Distinct Work': {'complete': True, 'media': [provider]}}
            result = apply_plan(state, database, make_plan(database, state, cache, 200))
            self.assertEqual(result['matchedFiles'], 1)
            anime = state['anime']['al123']
            self.assertEqual(anime['format'], 'OVA')
            self.assertEqual(anime['archiveSpecialReference']['id'], 123)
            self.assertTrue(compatible_record(anime, source))
            self.assertFalse(compatible_record({**anime, 'metadataProviderId': 456}, source))
            self.assertFalse(compatible_record({**anime, 'format': 'TV'}, source))
            self.assertEqual(json.loads(database.execute('SELECT record FROM files').fetchone()[0]), source)
            database.close()

    def test_exact_numbered_special_is_separate_from_tv(self):
        chosen, reason = choose_identity('Example OVA', [record()], [media()])
        self.assertEqual(chosen['id'], 123)
        self.assertIn('standalone-special', reason)
        parent = {'format': 'TV', 'declaredEpisodes': 12, 'year': 2020,
                  'verifiedArchiveTitles': ['Example OVA']}
        self.assertFalse(compatible_record(parent, record()))

    def test_conflicting_or_incomplete_evidence_is_held(self):
        for source in [record(episode=3), record(episode=None), record(multiEpisode=True),
                       record(name='Example - 01 [720p].mkv'),
                       record(name='Example OVA - 01-02 [720p].mkv'),
                       record(name='Example OVA - 01 [1080p].mkv'),
                       record(caption='Episode 02'), record(name='Example OVA - 01.5 [720p].mkv')]:
            with self.subTest(source=source):
                self.assertFalse(safe_special_record(source, 2))
        self.assertIsNone(choose_identity('Example OVA', [record()], [media(), media(id=456)])[0])
        self.assertIsNone(choose_identity('Example OVA', [record()], [media(status='NOT_YET_RELEASED')])[0])
        self.assertIsNone(choose_identity('Example OVA', [record()], [media(format='TV')])[0])

    def test_single_special_publishes_without_changing_source_number(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = open_db(Path(temporary) / 'pipeline.sqlite3')
            store_record(database, record(episode=None, name='Example OVA [720p].mkv'))
            database.execute("UPDATE files SET state='copied',destination_id=101 WHERE id=1")
            state = {'anime': {}, 'queue': {}}
            cache = {'Example OVA': {'complete': True, 'media': [media(episodes=1)]}}
            result = apply_plan(state, database, make_plan(database, state, cache, 200))
            self.assertEqual(result['matchedFiles'], 1)
            self.assertEqual(state['anime']['al123']['format'], 'OVA')
            self.assertEqual(state['queue']['archive:1']['episode'], 1)
            self.assertIsNone(json.loads(database.execute('SELECT record FROM files WHERE id=1').fetchone()[0])['episode'])
            database.close()

    def test_existing_tv_page_cannot_receive_special_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = open_db(Path(temporary) / 'pipeline.sqlite3')
            store_record(database, record())
            database.execute("UPDATE files SET state='copied',destination_id=101 WHERE id=1")
            state = {'anime': {'parent': {'metadataProviderId': 123, 'format': 'TV', 'year': 2020}}}
            cache = {'Example OVA': {'complete': True, 'media': [media()]}}
            self.assertEqual(make_plan(database, state, cache, 200)['entries'], [])
            database.close()


if __name__ == '__main__':
    unittest.main()
