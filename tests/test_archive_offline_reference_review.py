from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from archive_offline_reference_review import source_ids, literal_candidates, cross_reference


class OfflineReferenceTests(unittest.TestCase):
    def test_provider_ids_require_exact_hosts_and_paths(self):
        urls = ['https://anilist.co/anime/123', 'https://anilist.co.evil.test/anime/456',
                'https://evil.test/?url=https://anilist.co/anime/789', 'https://anilist.co/anime/0']
        self.assertEqual(source_ids(urls, 'anilist.co'), [123])

    def test_only_literal_names_are_candidates_never_prefixes_or_erased_seasons(self):
        records = [{'title': 'Complete Name', 'synonyms': ['Literal Alias'], 'sources': ['https://anilist.co/anime/123'],
                    'episodes': 12, 'type': 'TV', 'animeSeason': {'year': 2020}}]
        found = literal_candidates({'Complete': 3, 'Literal Alias': 2, 'Complete Name S2': 1}, records)
        self.assertEqual(set(found), {'Literal Alias'})
        self.assertEqual(found['Literal Alias'][0]['anilistIds'], [123])

    def test_cross_provider_agreement_is_still_not_an_assignment_certificate(self):
        candidate = {'anilistIds': [123], 'malIds': [456], 'episodes': 12, 'type': 'TV', 'year': 2020, 'status': 'FINISHED'}
        primary = {'id': 123, 'idMal': 456, 'episodes': 12, 'format': 'TV', 'startDate': {'year': 2020}, 'status': 'FINISHED'}
        result = cross_reference(candidate, primary)
        self.assertTrue(result['factsAgree'])
        self.assertFalse(result['certifiedAssignment'])
        conflict = cross_reference(candidate, {**primary, 'idMal': 789, 'episodes': 24})
        self.assertEqual(conflict['conflicts'], ['mal-id', 'episodes'])
        self.assertEqual(cross_reference(candidate, {**primary, 'status': 'RELEASING'})['conflicts'], ['status'])


if __name__ == '__main__': unittest.main()
