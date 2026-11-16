import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
import archive_alternate_reference_research as research


class AlternateReferenceTests(unittest.TestCase):
    def test_known_primary_identities_are_not_researched_again_as_unknown(self):
        primary = {'Example': {'complete': True, 'media': [{'id': 1, 'title': {'romaji': 'Example'}}]}}
        before = copy.deepcopy(primary)
        self.assertEqual(research.unresolved_queries({'Example': 10, 'Unresolved': 3}, primary), {'Unresolved': 3})
        self.assertEqual(primary, before)

    def test_partial_pages_resume_and_never_claim_completion(self):
        cache = {};task = {'query': 'Example', 'page': 1}
        page = {'pagination': {'has_next_page': True}, 'data': [{'mal_id': 123, 'title': 'Example'}]}
        self.assertFalse(research.accept_page(cache, task, page))
        following = research.next_tasks({'Example': 2}, cache)[0]
        self.assertEqual(following['page'], 2)
        self.assertTrue(research.accept_page(cache, following, {'pagination': {'has_next_page': False}, 'data': [{'mal_id': 456, 'title': 'Different'}]}))
        self.assertEqual([item['mal_id'] for item in cache['queries']['Example']['media']], [123, 456])
        self.assertEqual(research.next_tasks({'Example': 2}, cache), [])

    def test_missing_pagination_or_invalid_identity_does_not_mutate_the_cache(self):
        for bad in [[], {'pagination': [1], 'data': []}, {'data': []},
                    {'pagination': {'has_next_page': False}, 'data': [{'mal_id': True}]},
                    {'pagination': {'has_next_page': False, 'current_page': 2}, 'data': []}]:
            cache = {}
            with self.assertRaises(ValueError): research.accept_page(cache, {'query': 'Example', 'page': 1}, bad)
            self.assertEqual(cache, {})

    def test_broad_unfinished_queries_remain_counted_and_incomplete(self):
        cache = {};task = {'query': 'Example', 'page': 10}
        research.accept_page(cache, task, {'pagination': {'has_next_page': True}, 'data': []})
        self.assertFalse(cache['queries']['Example']['complete'])
        self.assertEqual(research.next_tasks({'Example': 2}, cache), [])
        with patch.object(research, 'atomic_write_json'):
            report = research.save_progress({'Example': 2}, 2, cache, 1, 'research_complete')
        self.assertEqual(report['remainingQueries'], 1)
        self.assertEqual(report['state'], 'research_complete_with_holds')


if __name__ == '__main__': unittest.main()
