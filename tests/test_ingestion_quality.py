import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/tg'))
import artwork
import metadata
from quality import clean_synopsis, normalize_record
from parse import parse_post
from ingest import merge_post
from catalog import build_catalog, build_links


class IngestionQualityTests(unittest.TestCase):
    def test_browser_and_worker_share_description_cleanup_cases(self):
        for row in json.loads((ROOT / 'tests/catalog-quality-cases.json').read_text()):
            self.assertEqual(clean_synopsis(row['input']), row['expected'])
            self.assertEqual(clean_synopsis(row['expected']), row['expected'])

    def test_unknown_year_is_not_the_post_date(self):
        text = '[🎥](https://example.org/image.jpg) Test\nژانرها: #فانتزی #اکشن\nفصل: نامشخص\n📥 لینک های دانلود:\nقسمت 1: [720p](https://t.me/AniPlusMiniBot?start=get_test)'
        result = parse_post(123, text, '2026-10-24T12:00:00Z')
        self.assertEqual(result['year'], 0)
        self.assertEqual(result['genres'], ['فانتزی', 'اکشن'])

    def test_normalization_handles_cached_backfill_records_and_keeps_gaps(self):
        record = {'year': 2026, 'seasonRaw': 'نامشخص', 'genres': ['#اکشن #فانتزی'],
                  'synopsis': 'داستان.\nژانرها: اشتباه', 'episodes': {'۰۲': {'720p': 'metadata-link'}, '07': {'1080p': 'archive-link'}, 'bad': {}, '0': {}}}
        before = copy.deepcopy(record)
        clean = normalize_record(record)
        self.assertEqual(clean['year'], 0)
        self.assertEqual(clean['genres'], ['اکشن', 'فانتزی'])
        self.assertEqual(clean['synopsis'], 'داستان.')
        self.assertEqual(set(clean['episodes']), {'0', '2', '7'})
        self.assertEqual(record, before)

    def test_both_source_links_survive_cached_post_merge_and_export(self):
        anime = {'slug': 'quality-test', 'key': 'a123', 'titleEn': 'Test', 'episodes': {'2': {'720p': 'metadata-link'}, '7': {'1080p': 'archive-link'}},
                 'postIds': [100], 'firstPostId': 100, 'lastPostId': 100}
        state = {'anime': {'a123': anime}, 'queue': {
            'metadata-link': {'status': 'done', 'url': 'https://example.org/2'},
            'archive-link': {'status': 'done', 'source': 'archive', 'url': 'https://example.org/7'}}}
        post = {'animeId': '123', 'postId': 101, 'date': '2026-10-24T12:00:00Z', 'titleEn': 'Test', 'genres': ['#فانتزی #اکشن'],
                'synopsis': 'داستان.\n👥 اطلاعات تیم ترجمه :', 'seasonRaw': 'نامشخص', 'episodes': {'۰۲': {'720p': 'new-repeated-link'}}}
        merge_post(state, post)
        self.assertEqual(state['anime']['a123']['episodes']['2']['720p'], 'metadata-link')
        self.assertEqual(state['anime']['a123']['episodes']['7']['1080p'], 'archive-link')
        row = build_catalog(state)[0]
        self.assertEqual((row['year'], row['highestEpisode'], row['indexedCount']), (0, 7, 2))
        self.assertEqual(row['source'], 'aniplus')
        self.assertEqual(set(build_links(state)), {'quality-test|2|720p', 'quality-test|7|1080p'})


class MetadataEnrichmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'src/lib').mkdir(parents=True)
        self.row = dict(slug='test', titleEn='Test', titleJa='テスト', year=0, season='نامشخص', format='TV', type='سریال', highestEpisode=9, episodes=2, studio='—', duration='')
        self.candidate = dict(id=1, type='ANIME', title={'english': 'Test', 'native': 'テスト'}, format='TV', startDate={'year': 2024}, seasonYear=2024, season='SPRING', episodes=12, duration=24, studios={'nodes': [{'name': 'Studio'}]})
        self.search = patch.object(metadata, 'search', return_value=[self.candidate]).start()
        self.addCleanup(patch.stopall)
        patch.object(artwork, 'INTERVAL', 0).start()

    def run_worker(self):
        return metadata.enrich([self.row], 3, self.root)

    def entries(self):
        return json.loads((self.root / 'src/lib/generated-metadata.json').read_text())['metadata']

    def test_verified_year_and_season_fill_once_without_source_mutation(self):
        before = copy.deepcopy(self.row)
        self.assertEqual(self.run_worker(), {'attempted': 1, 'replaced': 1})
        enriched = metadata.apply_metadata(self.row, self.entries())
        self.assertEqual((enriched['year'], enriched['season'], enriched['totalEpisodes']), (2024, 'بهار', 12))
        self.assertEqual(self.row, before)
        self.assertEqual(self.run_worker()['attempted'], 0)
        self.search.assert_called_once()

    def test_unannounced_year_stays_unknown_and_no_dates_are_invented(self):
        self.candidate.update(startDate={'year': None}, seasonYear=None, episodes=None)
        self.run_worker()
        enriched = metadata.apply_metadata(self.row, self.entries())
        self.assertEqual(enriched['year'], 0)
        self.assertNotIn('totalEpisodes', enriched)
        self.assertNotIn('releasedAt', enriched)

    def test_wrong_known_year_is_rejected(self):
        self.row['year'] = 2025
        self.assertEqual(self.run_worker()['replaced'], 0)

    def test_unknown_year_requires_two_distinct_canonical_titles(self):
        self.row['titleJa'] = ''
        self.assertEqual(self.run_worker()['replaced'], 0)

    def test_total_below_highest_number_is_never_used(self):
        self.candidate['episodes'] = 8
        self.run_worker()
        self.assertNotIn('totalEpisodes', metadata.apply_metadata(self.row, self.entries()))

    def test_identity_change_never_reuses_old_metadata(self):
        self.run_worker()
        renamed = {**self.row, 'titleEn': 'Another Season'}
        self.assertEqual(metadata.apply_metadata(renamed, self.entries())['year'], 0)

    def test_provider_failure_retains_original_and_is_cached(self):
        self.search.side_effect = TimeoutError()
        self.assertEqual(self.run_worker()['replaced'], 0)
        self.assertEqual(self.run_worker()['attempted'], 0)


if __name__ == '__main__':
    unittest.main()
