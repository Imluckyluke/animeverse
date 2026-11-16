import copy
import json
from pathlib import Path
import sqlite3
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from archive_season_audit import audit
from archive_identity import safe_episode_record
from backfill import _pick_archive_record, _roman_season, _season_compatible_record, parse_archive_fields, populate_archive_episodes
from resolver import _season_compatible, _season_part
from season_identity import sequence_markers


class RomanSeasonTests(unittest.TestCase):
    def test_ordinal_season_before_a_bare_episode_does_not_invent_a_second_season(self):
        from archive_identity import explicit_markers
        for number in [1, 3, 12, 41, 59]:
            name = f'@AnimeGateOfficial_Example_3rd_Season_{number}_720P.mkv'
            parsed = parse_archive_fields(name, '', 1)
            self.assertEqual((parsed['title'], parsed['season'], parsed['episode']), ('Example 3rd Season', 3, number))
            self.assertEqual(sequence_markers(name), {('season', 3)})
            self.assertEqual(explicit_markers(name), {('season', 3)})
            self.assertTrue(safe_episode_record(parsed))
            self.assertFalse(safe_episode_record({**parsed, 'episode': number + 1}))
        self.assertEqual(sequence_markers('Example 3rd Season S2 E01'), {('season', 3), ('season', 2)})
        self.assertEqual(explicit_markers('Example sixth season 41'), {('season', 6)})
        self.assertFalse(safe_episode_record({'id': 1, 'title': 'Example', 'episode': 41,
                         'quality': '720p', 'name': 'Example sixth season 41 [720p].mkv'}))
        self.assertFalse(safe_episode_record({'id': 1, 'title': 'Example 3rd Season', 'episode': 1,
                         'quality': '720p', 'name': 'Example 3rd Season S2 E01 [720p].mkv'}))
        from backfill import trailing_archive_episode
        self.assertIsNone(trailing_archive_episode('Example 3 [720p].mkv'))
        self.assertEqual(trailing_archive_episode('Example 3rd Season 6.mkv'), 6)
    def test_title_season_or_part_number_is_not_removed_when_it_equals_the_episode(self):
        for marker, number in [('Season', 1), ('Season', 2), ('Part', 2), ('Series', 3)]:
            name = f'Example {marker} {number} - {number:02} [720p].mkv'
            source = parse_archive_fields(name, '', 1)
            self.assertEqual(source['title'], f'Example {marker} {number}')
            self.assertEqual(source['episode'], number)

    def test_dotted_season_episode_quality_has_independent_numbering_evidence(self):
        name = 'Kodocha.S1.002.480p.DVD.AnimDL.ir.mkv'
        source = parse_archive_fields(name, '', 1)
        self.assertEqual((source['title'], source['episode'], source['season'], source['quality']),
                         ('Kodocha.S1', 2, 1, '480p'))
        self.assertTrue(safe_episode_record(source))
        self.assertFalse(safe_episode_record({**source, 'episode': 3, 'caption': 'Kodocha.S1 - 03 [480p]'}))
        unnumbered = parse_archive_fields('Example.S1.001.DVD.480p.mkv', '', 1)
        self.assertIsNone(unnumbered['episode'], 'An arbitrary dotted number without the strict quality boundary is not proof')

    def test_leading_season_and_episode_cannot_be_relabelled_by_a_caption(self):
        source = {'id': 1, 'title': '2.5 Dimensional Seduction S01', 'episode': 2, 'quality': '720p',
                  'name': '[@AnimeWorldqw]_S01_02_2_5_Dimensional_Seduction_720p.mkv',
                  'caption': '2.5 Dimensional Seduction S01 - 02 [720p]'}
        self.assertTrue(safe_episode_record(source))
        self.assertFalse(safe_episode_record({**source, 'episode': 1, 'caption': '2.5 Dimensional Seduction S01 - 01 [720p]'}))

    def test_equivalent_numeric_roman_and_unicode_markers(self):
        for title in ['Example II', 'Example ii', 'Example Ⅱ', 'Example Season II', 'Example Season Ⅱ', 'Example S02']:
            self.assertEqual(_season_part(title), (2, None), title)
            self.assertTrue(_season_compatible({'titleEn': title}, 'Example S02 - 01 [720p].mkv'))
            self.assertFalse(_season_compatible({'titleEn': title}, 'Example III - 01 [720p].mkv'))
        self.assertEqual(_season_part('Example VIII: Subtitle'), (8, None))
        self.assertEqual(_season_part('Example Season XIV'), (14, None))

    def test_word_symbols_and_distinct_sequence_types_are_not_seasons(self):
        for title in ['Project X', 'Gundam V', 'To Be Hero X', 'Jashin-chan Dropkick X',
                      'Senki Zesshou Symphogear XV', 'Final Fantasy VII', 'Raise wa Tanin ga Ii',
                      'Raise wa Tanin ga II', 'Diamond no Ace Act II', 'Example Movie II',
                      'Example Part II', 'I Want to Eat Your Pancreas']:
            self.assertIsNone(_roman_season(title), title)
        self.assertEqual(_season_part('Example Season II Part III'), (2, 3))
        self.assertEqual(sequence_markers('Diamond No Ace Act II Second Season - 12 [720p]'), {('act', 2), ('season', 2)})
        self.assertEqual(sequence_markers('Spy x Family Second Part - 10'), set())

    def test_caption_cannot_erase_filename_roman_season(self):
        record = parse_archive_fields('Example II - 02 [720p].mkv', 'Example III - 02 [720p]', 1)
        self.assertFalse(safe_episode_record(record))
        self.assertFalse(_season_compatible_record({'titleEn': 'Example III'}, record['title'], record))
        self.assertFalse(_season_compatible({'titleEn': 'Example III'}, 'Example III\nExample S2 - 02 [720p]'))
        self.assertTrue(safe_episode_record(parse_archive_fields('Example II - 02 [720p].mkv', 'Example S2 - 02 [720p]', 1)))

    def test_conflicting_page_aliases_fail_closed(self):
        self.assertFalse(_season_compatible({'titleEn': 'Example Season 3', 'titleOriginal': 'Example II'}, 'Example III - 02'))
        self.assertTrue(_season_compatible({'titleEn': 'Example Season 3', 'titleOriginal': 'Example III'}, 'Example S3 - 02'))

    def test_ambiguous_single_letters_cannot_bypass_a_known_season(self):
        self.assertFalse(_season_compatible({'titleEn': 'Example VII'}, 'Example V - 02 [720p]'))
        self.assertFalse(_season_compatible({'titleEn': 'Example IV'}, 'Example X - 02 [720p]'))
        self.assertTrue(_season_compatible({'titleEn': 'Spy x Family Season 3'}, 'Spy x Family S3 - 02 [720p]'))
        self.assertTrue(_season_compatible({'titleEn': 'Example Season 2'}, 'Example S2 - 02 [720p x 265p]'))

    def test_picker_and_population_reject_wrong_season_without_mutating_source(self):
        wrong = parse_archive_fields('Example II - 02 [720p].mkv', '', 1)
        right = parse_archive_fields('Example III - 02 [720p].mkv', '', 2)
        anime = {'titleEn': 'Example III', 'slug': 'example-iii', 'episodes': {}, 'declaredEpisodes': 12}
        request = {'episode': 2, 'quality': '720p'}
        self.assertIsNone(_pick_archive_record([wrong], request, anime))
        self.assertEqual(_pick_archive_record([wrong, right], request, anime), right)
        state = {'anime': {'a': copy.deepcopy(anime)}, 'queue': {}}
        records = copy.deepcopy([wrong, right])
        self.assertEqual(populate_archive_episodes(state, ['a'], {'a': records}), 1)
        self.assertEqual(state['anime']['a']['episodes']['2']['720p'], 'archive:2')
        self.assertEqual(records, [wrong, right])

    def test_roman_movie_and_ova_still_keep_distinct_media_guards(self):
        movie = parse_archive_fields('Example Movie II [720p].mkv', '', 1)
        self.assertIsNone(movie['episode'])
        self.assertIsNone(movie['season'])
        self.assertFalse(_season_compatible_record({'titleEn': 'Example II', 'format': 'TV'}, movie['title'], movie))
        self.assertIsNone(_roman_season('Example OVA II'))

    def test_full_audit_is_read_only_and_does_not_certify_unknown_provenance(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.executescript('CREATE TABLE files(id,record,document_id,destination_id,anime_key,state); CREATE TABLE destination(document_id,message_id);')
        record = parse_archive_fields('Example II - 02 [720p].mkv', 'Example III - 02 [720p]', 1)
        db.execute('INSERT INTO files VALUES (?,?,?,?,?,?)', (1, json.dumps(record), 'doc', 101, 'a', 'copied'))
        state = {'anime': {'a': {'slug': 'example', 'titleEn': 'Example III', 'episodes': {'2': {'720p': 'old'}, '3': {'720p': 'unknown'}}}},
                 'queue': {'old': {'status': 'done', 'url': 'https://t.me/testanivers/101'},
                           'unknown': {'status': 'done', 'url': 'https://t.me/testanivers/102'}}}
        before, changes = copy.deepcopy(state), db.total_changes
        report = audit(state, db)
        self.assertEqual(report['summary']['conflictingReadySlots'], 1)
        self.assertEqual(report['summary']['unverifiedReadySlots'], 1)
        self.assertEqual(db.total_changes, changes)
        self.assertEqual(state, before)
        state['queue']['old']['url'] = 'https://t.me/another_channel/101'
        self.assertEqual(audit(state, db)['summary']['unverifiedReadySlots'], 2)
        db.close()


if __name__ == '__main__':
    unittest.main()
