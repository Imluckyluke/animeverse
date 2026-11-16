import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from backfill import parse_archive_fields
from resolver import _season_compatible, _season_part
from archive_identity import canonical_query, choose_identity, compatible_record, explicit_markers, identity_names, normalized, safe_episode_record


class ExplicitSeasonEpisodeTests(unittest.TestCase):
    def test_explicit_season_episode_variants(self):
        for marker in ['S2 E14', 'S02E14', 'S02.E14', 's02_e14', 'S02-E14']:
            with self.subTest(marker=marker):
                record = parse_archive_fields(f'Example {marker} [720p].mkv', '', 1)
                self.assertEqual(record['episode'], 14)
                self.assertEqual(record['season'], 2)
                self.assertEqual(_season_part(record['title'])[0], 2)
                self.assertTrue(_season_compatible({'titleEn': 'Example Season 2'}, record['title']))
                self.assertFalse(_season_compatible({'titleEn': 'Example Season 3'}, record['title']))
                self.assertTrue(safe_episode_record(record))

    def test_explicit_episode_does_not_become_season_number(self):
        record = parse_archive_fields('Example S02E03 [1080p].mkv', '', 1)
        self.assertEqual((record['season'], record['episode']), (2, 3))

    def test_equivalent_season_notation_and_conflicts(self):
        expected = {('season', 2)}
        for text in ['S2', 'S02E14', 'season 2', '2nd season', 'Second Season', 'فصل: ۲']:
            self.assertEqual(explicit_markers(text), expected)
        record = parse_archive_fields('Example S02E14 [720p].mkv', '', 1)
        record['title'] = 'Example فصل: 2'
        self.assertTrue(safe_episode_record(record))
        record['name'] = 'Example S03E14 [720p].mkv'
        self.assertFalse(safe_episode_record(record))

    def test_canonical_labels_keep_explicit_season_and_part(self):
        expected = normalized('Example Season 2')
        for title in ['Example S02', 'Example 2nd Season', 'Example Second Season', 'نام انیمه : Example فصل : ۲']:
            self.assertEqual(normalized(canonical_query(title)), expected)
        self.assertNotEqual(normalized(canonical_query('Example Part 2')), expected)
        self.assertNotEqual(normalized(canonical_query('Example S3')), expected)
        self.assertNotEqual(normalized(canonical_query('Example')), expected)

    def test_canonical_season_identity_still_rejects_competing_versions(self):
        media = {'id': 1, 'title': {'romaji': 'Example 2nd Season'}, 'synonyms': [],
                 'format': 'TV', 'status': 'FINISHED', 'episodes': 12, 'startDate': {'year': 2020}}
        record = {'episode': 2, 'name': 'Example S2 - 02 [720p].mkv'}
        self.assertEqual(choose_identity('Example S02', [record], [media])[0]['id'], 1)
        self.assertIsNone(choose_identity('Example S3', [record], [media])[0])
        self.assertIsNone(choose_identity('Example S2', [record], [media, {**media, 'id': 2}])[0])

    def test_first_season_label_does_not_choose_a_remake(self):
        original = {'id': 1, 'title': {'romaji': 'Example'}, 'synonyms': [], 'format': 'TV',
                    'episodes': 26, 'status': 'FINISHED', 'startDate': {'year': 2001}}
        remake = {**original, 'id': 2, 'title': {'romaji': 'Example 1st Season'}, 'startDate': {'year': 2019}}
        chosen, reason = choose_identity('Example S1', [{'episode': 2, 'name': 'Example S1 - 02.mkv'}], [original, remake])
        self.assertIsNone(chosen)
        self.assertEqual(reason, 'unmarked-remake-year')

    def test_canonicalizer_does_not_strip_unrecognized_title_words(self):
        self.assertEqual(canonical_query('@Unknown Example'), '@Unknown Example')
        self.assertEqual(canonical_query('Example Quality'), 'Example Quality')
        self.assertEqual(canonical_query('@AnimeWorldqw) Example - - Quality'), 'Example')
        self.assertEqual(canonical_query('Example Quality Format mkv'), 'Example')

    def test_quality_without_p_cannot_be_overridden_by_caption(self):
        record = parse_archive_fields('Example - 02 [480 BD].mkv', 'Example - 02 [1080p]', 1)
        self.assertFalse(safe_episode_record(record))
        record = parse_archive_fields('Example - 02 [480 BD].mkv', 'Example - 02 [480p]', 1)
        self.assertTrue(safe_episode_record(record))

    def test_caption_cannot_relabel_filename_episode(self):
        record = parse_archive_fields('Example S02E14 [720p].mkv', 'Example S02E13 [720p]', 1)
        self.assertFalse(safe_episode_record(record))
        record = parse_archive_fields('Example - 14 [720p].mkv', 'Example - 13 [720p]', 1)
        self.assertFalse(safe_episode_record(record))

    def test_numeric_provider_alias_requires_explicit_same_id_season(self):
        media = {'title': {'romaji': 'Example 2', 'english': 'Other Name Season 2'}, 'synonyms': []}
        self.assertIn(normalized('Example Season 2'), identity_names(media))
        self.assertNotIn(normalized('Example Season 2'), identity_names({**media, 'title': {'romaji': 'Example 2'}}))
        self.assertNotIn(normalized('Example Season 3'), identity_names(media))
        split = {**media, 'title': {**media['title'], 'romaji': 'Example 2', 'english': 'Other Name Season 2 Part 2'}}
        self.assertNotIn(normalized('Example Season 2'), identity_names(split))

    def test_index_caption_typo_requires_independent_filename_evidence(self):
        anime = {'year': 2010, 'declaredEpisodes': 24, 'verifiedArchiveTitles': ['Toaru Majutsu Index ll']}
        record = {'id': 1, 'episode': 2, 'title': 'Toaru Majutsu Index ll', 'quality': '720p',
                  'name': '[AWHT] Toaru Majutsu no Index II - 02 [720p].mkv'}
        self.assertTrue(compatible_record(anime, record))
        self.assertFalse(compatible_record(anime, {**record, 'name': '[AWHT] Toaru Majutsu no Index III - 02 [720p].mkv'}))

    def test_fractional_recap_episode_is_not_truncated_to_an_integer(self):
        for marker in ['- 14.5', 'E14.5', 'S02E14.5', '- 14,5']:
            record = {'id': 1, 'title': 'Example S02', 'name': f'Example S02 {marker} [720p].mkv',
                      'episode': 14, 'quality': '720p'}
            self.assertFalse(safe_episode_record(record))


if __name__ == '__main__':
    unittest.main()
