import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

path = Path(__file__).resolve().parents[1] / 'tools/tg/connections.py'
spec = importlib.util.spec_from_file_location('public_connections', path)
connections = importlib.util.module_from_spec(spec)
spec.loader.exec_module(connections)


class ConnectionDataTests(unittest.TestCase):
    def test_only_exact_source_metadata_or_explicit_anilist_ids_are_used(self):
        row = {'slug': 'example', 'titleEn': 'Example II', 'titleJa': '例二', 'year': 2024}
        entry = {'identity': {'titleEn': 'Example II', 'titleJa': '例二'}, 'providerId': 99, 'data': {'year': 2024}}
        self.assertEqual(connections.metadata_provider_id(row, entry), 99)
        self.assertIsNone(connections.metadata_provider_id({**row, 'titleEn': 'Example III'}, entry))
        self.assertIsNone(connections.metadata_provider_id({**row, 'year': 2000}, entry))
        self.assertEqual(connections.verified_sources([row], {'example': entry}, {'example'}), {})
        conflicting = {**row, 'metadataSource': 'anilist', 'metadataUrl': 'https://anilist.co/anime/100'}
        self.assertEqual(connections.verified_sources([conflicting], {'example': entry}), {})

    def test_public_nodes_keep_movies_specials_distinct_and_drop_manga(self):
        value = {'id': 1, 'type': 'ANIME', 'format': 'MOVIE', 'title': {'english': 'Example Movie'}, 'startDate': {'year': 2023}}
        self.assertEqual(connections.node_snapshot(value)['format'], 'MOVIE')
        self.assertIsNone(connections.node_snapshot({**value, 'type': 'MANGA'}))
        self.assertEqual(connections.node_snapshot({**value, 'startDate': {'year': None}})['year'], None)
        self.assertEqual(connections.safe_cover('https://tracker.example/pixel.png'), '')

    def test_provider_rate_wait_is_persisted_not_bypassed(self):
        error = HTTPError(connections.API_URL, 429, 'Too Many Requests', {'Retry-After': '3600'}, io.BytesIO(b'{}'))
        with patch.object(connections.time, 'time', return_value=100), patch.object(connections.urllib.request, 'urlopen', side_effect=error) as request, patch.object(connections.time, 'sleep') as sleep:
            result, status, deadline = connections.fetch_batch([1], budget_end=200)
        self.assertIsNone(result)
        self.assertEqual(status, 'rate-limited')
        self.assertEqual(deadline, 3700)
        self.assertEqual(request.call_count, 1)
        sleep.assert_not_called()

    def test_generated_cache_is_public_metadata_not_internal_queue_or_download_state(self):
        root = Path(__file__).resolve().parents[1]
        raw = (root / 'src/lib/generated-connections.json').read_text()
        value = json.loads(raw)
        self.assertGreater(len(value['entries']), 0)
        for forbidden in ['chatId', 'deepLink', 'session', 'password', 'botToken', 'destination_id']:
            self.assertNotIn('"' + forbidden + '"', raw)

    def test_graph_support_entries_survive_a_regular_enrich_run(self):
        support = {
            'sourceUrl': 'https://anilist.co/anime/99',
            'checkedAt': '2026-10-30T00:00:00+00:00',
            'identity': {'id': 99, 'type': 'ANIME', 'titleEn': 'Bridge', 'titleJa': '',
                         'titleRomaji': '', 'year': 2021, 'format': 'TV',
                         'cover': '', 'providerId': 99},
            'sources': [], 'relations': [], 'recommendations': [], 'support': True,
        }
        self.assertTrue(connections.is_support_entry(support))
        self.assertFalse(connections.is_support_entry({**support, 'sources': [{'titleEn': 'Local'}]}))
        result = connections.enrich([], {}, {'entries': {'99': support}}, max_requests=0)
        self.assertIn('99', result['entries'])
        self.assertTrue(result['entries']['99']['support'])


if __name__ == '__main__': unittest.main()
