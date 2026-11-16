import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from archive_identity import make_plan, filename_web_candidate
from archive_pipeline import open_db, store_record


def provider(ident=123, year=2020, **changes):
    return {'id': ident, 'title': {'romaji': 'Example'}, 'synonyms': [], 'format': 'TV',
            'status': 'FINISHED', 'episodes': 12, 'startDate': {'year': year}, **changes}


class CrossQueryReferenceTests(unittest.TestCase):
    def plan(self, cache, name='Example - 02 [720p].mkv'):
        with tempfile.TemporaryDirectory() as temporary:
            db = open_db(Path(temporary) / 'files.sqlite3')
            store_record(db, {'id': 1, 'title': 'Example', 'name': name, 'episode': 2, 'quality': '720p'})
            db.execute("UPDATE files SET state='copied',destination_id=101 WHERE id=1")
            result = make_plan(db, {'anime': {}}, cache, 200)
            db.close()
            return result

    def test_actual_exact_provider_name_found_under_another_complete_query_is_usable(self):
        cache = {'Example': {'complete': True, 'media': []}, 'Different query': {'complete': True, 'media': [provider()]}}
        before = copy.deepcopy(cache)
        self.assertEqual(self.plan(cache)['entries'][0]['providerId'], 123)
        self.assertEqual(cache, before)

    def test_neither_partial_source_results_nor_an_unfinished_target_search_can_be_promoted(self):
        for source_complete, target_complete in [(False, True), (True, False)]:
            cache = {'Example': {'complete': target_complete, 'media': []},
                     'Different query': {'complete': source_complete, 'media': [provider()]}}
            self.assertEqual(self.plan(cache)['entries'], [])

    def test_competing_remake_from_another_query_strengthens_the_unknown_year_hold(self):
        cache = {'Example': {'complete': True, 'media': [provider()]},
                 'Example remake': {'complete': True, 'media': [provider(456, 2024, title={'romaji': 'Example (2024)'}, synonyms=['Example'])]}}
        self.assertEqual(self.plan(cache)['entries'], [])
        self.assertEqual(self.plan(cache, 'Example (2020) - 02 [720p].mkv')['entries'][0]['providerId'], 123)

    def test_a_full_filename_reference_can_recover_an_unknown_caption_but_not_a_known_different_one(self):
        cache = {'Example': {'complete': True, 'media': []}, 'Alias': {'complete': True, 'media': []},
                 'Different query': {'complete': True, 'media': [provider()]}}
        source = {'id': 1, 'title': 'Alias', 'name': 'Example - 02 [720p].mkv', 'episode': 2, 'quality': '720p'}
        self.assertEqual(filename_web_candidate(source, 1, cache)['title'], 'Example')
        cache['Another query'] = {'complete': True, 'media': [provider(456, title={'romaji': 'Alias'})]}
        self.assertIsNone(filename_web_candidate(source, 1, cache))

    def test_an_unlabeled_ova_cannot_hide_a_same_year_tv_version_found_elsewhere(self):
        cache = {'Example': {'complete': True, 'media': [provider(format='OVA')]},
                 'TV query': {'complete': True, 'media': [provider(456, title={'romaji': 'Example (TV)'})]}}
        self.assertEqual(self.plan(cache, 'Example (2020) - 02 [720p].mkv')['entries'], [])


if __name__ == '__main__': unittest.main()
