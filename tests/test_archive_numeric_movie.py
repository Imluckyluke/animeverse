import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from backfill import parse_archive_fields, _season_compatible_record
from archive_identity import choose_identity, compatible_record, safe_episode_record, safe_movie_record


class NumericMovieTests(unittest.TestCase):
    def test_bare_number_and_end_tag_preserve_episode_and_season(self):
        for name in ['Example 01 [720p].mkv', 'Example - 01 [End] [720p].mkv',
                     'Example 01 [720p] [End].mkv', 'Example S02 - 01 [End] [720p].mkv',
                     'Example 01 720p.mkv', 'Example - 01 [1080p x265].mkv',
                     'Example 01 1080p x265.mkv', 'Example 01 [End] 720p.mkv',
                     'Example 01 (1080p x265).mkv']:
            with self.subTest(name=name):
                parsed = parse_archive_fields(name, '', 1)
                self.assertEqual(parsed['episode'], 1)
                self.assertEqual(parsed['title'], 'Example S02' if 'S02' in name else 'Example')
                self.assertTrue(safe_episode_record(parsed))

    def test_movie_number_is_film_identity_not_an_episode(self):
        for marker in ['Movie 02', 'Movie - 02', 'Movie02', 'Movie : 2']:
            with self.subTest(marker=marker):
                parsed = parse_archive_fields(f'Example {marker} [720p].mkv', '', 1)
                self.assertEqual(parsed['title'], f'Example {marker}')
                self.assertIsNone(parsed['episode'])
                self.assertEqual(parsed['mediaKind'], 'MOVIE')
                self.assertTrue(safe_movie_record(parsed))

    def test_title_number_is_not_overwritten_after_explicit_episode(self):
        parsed = parse_archive_fields('Example 86 E01 [720p].mkv', '', 1)
        self.assertEqual((parsed['title'], parsed['episode']), ('Example 86', 1))
        for marker in ['Season 02', 'Part 02', 'Series 02', '2001', '00']:
            parsed = parse_archive_fields(f'Example {marker} [720p].mkv', '', 1)
            self.assertEqual(parsed['title'], f'Example {marker}')
            self.assertIsNone(parsed['episode'])
        self.assertIsNone(parse_archive_fields('Example 720 [720p].mkv', '', 1)['episode'])

    def test_bare_caption_number_cannot_override_filename(self):
        parsed = parse_archive_fields('Example 01 [720p].mkv', 'Example 02 [720p]', 1)
        self.assertFalse(safe_episode_record(parsed))

    def test_movie_cannot_bind_to_tv_even_if_caption_looks_like_an_episode(self):
        parsed = parse_archive_fields('Example Movie 02 [720p].mkv', 'Example - 02 [720p]', 1)
        parent = {'format': 'TV', 'declaredEpisodes': 12, 'year': 2020, 'verifiedArchiveTitles': ['Example']}
        self.assertFalse(compatible_record(parent, parsed))
        self.assertFalse(_season_compatible_record(parent, parsed['title'], parsed))
        tv = {'id': 1, 'title': {'romaji': 'Example'}, 'format': 'TV', 'episodes': 12,
              'status': 'FINISHED', 'startDate': {'year': 2020}}
        self.assertIsNone(choose_identity('Example', [parsed], [tv])[0])

    def test_movie_still_needs_a_unique_reference_and_known_quality(self):
        parsed = parse_archive_fields('Example Movie 02 [720p].mkv', '', 1)
        movie = {'id': 1, 'title': {'romaji': 'Example Movie 02'}, 'format': 'MOVIE',
                 'episodes': 1, 'status': 'FINISHED', 'startDate': {'year': 2020}}
        self.assertEqual(choose_identity(parsed['title'], [parsed], [movie])[0]['id'], 1)
        self.assertIsNone(choose_identity(parsed['title'], [parsed], [movie, {**movie, 'id': 2}])[0])
        self.assertIsNone(parse_archive_fields('Example 01 HD.mkv', '', 1))
        self.assertFalse(safe_movie_record({**parsed, 'name': 'Example Movie 02 E01 [720p].mkv'}))


if __name__ == '__main__':
    unittest.main()
