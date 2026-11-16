from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from archive_provider_node_research import accept_nodes, node_inventory, primary_cache_with_nodes, PRIMARY_NODE_KEY


class ProviderNodeResearchTests(unittest.TestCase):
    def primary(self):
        return {'id': 1, 'idMal': 2, 'type': 'ANIME', 'title': {'romaji': 'Actual Name'}, 'synonyms': [],
                'format': 'TV', 'status': 'FINISHED', 'episodes': 12, 'startDate': {'year': 2020}}

    def test_staging_primary_nodes_is_pure_and_never_imports_external_aliases(self):
        before = {'__provider__': {'blockedUntil': 12345}}
        document = {'version': 1, 'inventory': {'1': {'queries': ['Unproven Alias']}},
                    'nodes': {'1': {'complete': True, 'media': self.primary()}, '2': {'complete': False, 'held': True}}}
        staged = primary_cache_with_nodes(before, document)
        self.assertEqual(before, {'__provider__': {'blockedUntil': 12345}})
        self.assertEqual(staged['__provider__'], before['__provider__'])
        self.assertEqual(staged[PRIMARY_NODE_KEY]['reviewedWebMedia'][0]['synonyms'], [])
        self.assertNotIn('Unproven Alias', str(staged))
        self.assertEqual(staged[PRIMARY_NODE_KEY]['skippedIncompleteNodes'], 1)

    def test_a_forged_id_or_partial_primary_shape_cannot_be_staged(self):
        for media in [{**self.primary(), 'id': 3}, {'id': 1, 'type': 'ANIME'}]:
            with self.assertRaises(ValueError):
                primary_cache_with_nodes({}, {'version': 1, 'nodes': {'1': {'complete': True, 'media': media}}})

    def test_primary_nodes_are_isolated_and_missing_ids_remain_explicit_holds(self):
        cache = {}
        accept_nodes(cache, [1, 2], {'Page': {'pageInfo': {'hasNextPage': False}, 'media': [{'id': 1, 'type': 'ANIME'}]}})
        self.assertTrue(cache['nodes']['1']['complete'])
        self.assertFalse(cache['nodes']['2']['complete'])
        self.assertTrue(cache['nodes']['2']['held'])

    def test_partial_or_unrequested_nodes_never_mutate_the_cache(self):
        for result in [
            [], {'Page': {'pageInfo': [False], 'media': []}},
            {'Page': {'pageInfo': {'hasNextPage': True}, 'media': []}},
            {'Page': {'pageInfo': {'hasNextPage': False}, 'media': [{'id': 3, 'type': 'ANIME'}]}},
        ]:
            cache = {}
            with self.assertRaises(ValueError): accept_nodes(cache, [1], result)
            self.assertEqual(cache, {})

    def test_complete_primary_nodes_are_not_fetched_again_for_a_literal_alias(self):
        report = {'entries': [{'query': 'Alias', 'candidates': [{'anilistIds': [1, 2], 'malIds': [3]}]}]}
        primary = {'Known': {'complete': True, 'media': [{'id': 1, 'idMal': 3, 'type': 'ANIME',
                    'format': 'TV', 'episodes': 12, 'status': 'FINISHED', 'startDate': {'year': 2020}}]}}
        self.assertEqual(set(node_inventory(report, primary)), {2})


if __name__ == '__main__': unittest.main()
