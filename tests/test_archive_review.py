import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from archive_review import csv_value, review_rows, included_scope_ids


def row(ident=1, **changes):
    record = {'title': 'Example', 'name': 'Example - 02 [720p].mkv',
              'episode': 2, 'quality': '720p'}
    record.update(changes)
    return {'id': ident, 'destination_id': ident + 100, 'anime_key': None, 'parsed': record}


def provider(**changes):
    media = {'id': 123, 'title': {'romaji': 'Example'}, 'synonyms': [],
             'format': 'TV', 'status': 'FINISHED', 'episodes': 12, 'startDate': {'year': 2020}}
    media.update(changes)
    return media


class ArchiveReviewTests(unittest.TestCase):
    def test_included_original_scope_preserves_resolved_ids_and_rejects_invalid_rosters(self):
        prior_review = {1, 2}
        self.assertEqual(prior_review | included_scope_ids({'ids': [2, 3, 4]}), {1, 2, 3, 4})
        for invalid in [{'ids': [True]}, {'ids': ['1']}, {'ids': [0]}, {'ids': None}, []]:
            with self.assertRaises(ValueError): included_scope_ids(invalid)

    def review(self, rows, cache=None, bindings=None, state=None):
        return review_rows(rows, state or {'anime': {}}, cache or {}, bindings or {})

    def test_every_file_gets_exactly_one_status(self):
        records = [row(), row(2, title=None), row(3, episode=None), row(4, name='subtitle.zip')]
        result = self.review(records)
        self.assertEqual([item['status'] for item in result],
                         ['reference_pending', 'reference_pending', 'missing_episode', 'not_video'])
        self.assertEqual({item['id'] for item in result}, {1, 2, 3, 4})
        self.assertEqual(result[1]['title'], 'Example')
        self.assertIsNone(records[1]['parsed']['title'])

    def test_unrelated_pool_nodes_are_not_candidates_for_unparsed_files(self):
        media=provider(id=204491,title={'romaji':'Miss Monochrome: MUSIC CLIPS'},format='MUSIC')
        result=self.review([row(1,title=None,name='a.mkv',episode=None,quality=None)],
                           {'unrelated':{'complete':True,'media':[media]}})[0]
        self.assertEqual(result['status'],'missing_title')
        self.assertEqual(result['providerCandidates'],'')

    def test_resolved_ids_remain_accounted(self):
        record = row()
        record['anime_key'] = 'known'
        result = self.review([record])[0]
        self.assertEqual(result['status'], 'matched')
        self.assertEqual(result['animeKey'], 'known')

    def test_pending_reference_is_not_reported_as_no_match(self):
        result = self.review([row()], {'Example': {'complete': False, 'error': 'HTTPError'}})[0]
        self.assertEqual(result['status'], 'reference_pending')
        self.assertEqual(result['reason'], 'HTTPError')
        result = self.review([row()], {'Example': {'complete': True, 'media': []}})[0]
        self.assertEqual(result['status'], 'no_reference_match')

    def test_episode_bounds_and_mixed_numbering_are_separate(self):
        results = self.review([row(), row(2, episode=13, name='Example - 13 [720p].mkv')],
                              {'Example': {'complete': True, 'media': [provider()]}})
        self.assertEqual([item['status'] for item in results], ['mixed_numbering', 'episode_out_of_bounds'])

    def test_ambiguous_remake_is_held(self):
        results = self.review([row()], {'Example': {'complete': True, 'media': [
            provider(), provider(id=456, startDate={'year': 2024})]}})
        self.assertEqual(results[0]['status'], 'ambiguous_remake')

    def test_a_complete_canonical_reference_is_not_reported_as_pending(self):
        result = self.review([row()], {'Example': {'complete': False, 'canonicalComplete': True, 'canonicalMedia': [provider()]}})
        self.assertEqual(result[0]['status'], 'ready_to_bind')

    def test_a_certified_single_standalone_special_is_not_reported_as_missing_an_episode(self):
        source = row(id=1, episode=None, name='Example (2020) [720p].mkv')
        cache = {'Example': {'complete': True, 'media': [provider(format='SPECIAL', episodes=1)]}}
        self.assertEqual(self.review([source], cache)[0]['status'], 'ready_to_bind')
        parent = {'anime': {'tv': {'titleEn': 'Example', 'format': 'TV', 'metadataProviderId': 123, 'year': 2020}}}
        self.assertEqual(self.review([source], cache, state=parent)[0]['status'], 'catalog_conflict')

    def test_bindings_and_existing_page_conflicts_are_not_ready(self):
        cache = {'Example': {'complete': True, 'media': [provider()]}}
        result = self.review([row()], cache, {'Example': {'conflict': 1}})[0]
        self.assertEqual(result['status'], 'binding_conflict')
        state = {'anime': {'existing': {'titleEn': 'Example', 'year': 2024}}}
        self.assertEqual(self.review([row()], cache, state=state)[0]['status'], 'catalog_conflict')
        self.assertEqual(self.review([row()], cache)[0]['status'], 'ready_to_bind')

    def test_spreadsheet_formulas_are_escaped(self):
        self.assertEqual(csv_value('=1+2'), "'=1+2")
        self.assertEqual(csv_value('Example'), 'Example')


if __name__ == '__main__':
    unittest.main()
