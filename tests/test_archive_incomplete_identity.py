"""Filename identity is independent of numeric resolution; hints never bind."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from backfill import archive_identity_hint, parse_archive_fields
from archive_identity import safe_episode_record
from archive_review import review_rows
from resolver import _quality_of


class IncompleteArchiveIdentityTests(unittest.TestCase):
    def test_reported_names_keep_title_episode_without_inventing_quality(self):
        for name, title, episode in [
            ('Kiznaiver HD - 05.mkv', 'Kiznaiver', 5),
            ('UQ Holder HD - 08.mkv', 'UQ Holder', 8),
            ('Owari no Seraph - 12 END.mkv', 'Owari no Seraph', 12),
            ('Kiznaiver HD - 12 - END.mkv', 'Kiznaiver', 12),
            ('UQ Holder HD - 12 - END.mkv', 'UQ Holder', 12),
            ('Owari no Seraph - Nagoya Kessen Hen S2 - 03.mkv', 'Owari no Seraph - Nagoya Kessen Hen S2', 3),
            ('Yahari Ore no Seishun Love Comedy wa Machigatteiru Zoku - 03.mkv',
             'Yahari Ore no Seishun Love Comedy wa Machigatteiru Zoku', 3),
        ]:
            with self.subTest(name=name):
                original = {'id': 1, 'name': name, 'size': 100}
                saved = copy.deepcopy(original)
                parsed = archive_identity_hint(original)
                self.assertEqual(parsed['title'], title)
                self.assertEqual(parsed['episode'], episode)
                self.assertEqual(parsed['quality'], '')
                self.assertFalse(safe_episode_record(parsed))
                self.assertIsNone(parse_archive_fields(name, '', 1))
                self.assertEqual(original, saved)

    def test_explicit_576p_is_supported_but_hd_is_not_a_numeric_resolution(self):
        parsed = parse_archive_fields('Example - 03 [576p].mkv', '', 1)
        self.assertEqual(parsed['title'], 'Example')
        self.assertEqual(parsed['quality'], '576p')
        self.assertTrue(safe_episode_record(parsed))
        self.assertEqual(_quality_of('HD')[0], '')
        self.assertEqual(_quality_of('[576p]')[0], '576p')
        self.assertFalse(safe_episode_record({**parsed, 'quality': '720p'}))
        self.assertFalse(safe_episode_record({**parsed, 'caption': 'Example - 03 [720p]'}))

    def test_numeric_file_ids_do_not_manufacture_a_resolution(self):
        for text in ['6764672032.mp4','7114867204.mp4','6759681086.mp4','title1080number']:
            self.assertEqual(_quality_of(text)[0],'',text)
        for name in ['6764672032.mp4','7114867204.mp4','6764672032 (1).mp4','6807018108-720p.mp4']:
            source={'id':1,'name':name}
            self.assertEqual(archive_identity_hint(source),source)
        for text in ['Example_720p_E02.mkv','Example [720p].mkv','720p x265','720px265','720']:
            self.assertEqual(_quality_of(text)[0],'720p',text)

    def test_existing_identity_and_conflicting_number_are_never_relabelled(self):
        for changes in [{'title': 'Different'}, {'episode': 9}, {'quality': '1080p'}, {'season': 2}]:
            record = {'id': 1, 'name': 'Kiznaiver HD - 05.mkv', **changes}
            self.assertEqual(archive_identity_hint(record), record)

    def test_reviewed_lost_girls_part_is_not_the_overall_oad_number(self):
        raw={'id':2212,'name':'[MrAnime.pw] OVA 08 - 16.5C - Lost Girls Part 03 [576p].mkv'}
        result=archive_identity_hint(raw)
        self.assertEqual(result['title'],'Shingeki no Kyojin: LOST GIRLS')
        self.assertEqual(result['episode'],3)
        self.assertEqual(result['quality'],'576p')
        self.assertEqual(result['sourceNumberingEvidence']['overallOad'],8)
        self.assertNotIn('title',raw)

    def test_review_reports_missing_resolution_not_missing_title_without_changing_source(self):
        record = {'id': 1, 'name': 'Kiznaiver HD - 05.mkv'}
        rows = [{'id': 1, 'destination_id': 10, 'anime_key': None, 'parsed': record}]
        before = copy.deepcopy(rows)
        result = review_rows(rows, {'anime': {}}, {}, {})
        self.assertEqual(result[0]['status'], 'missing_quality')
        self.assertEqual(rows, before)


if __name__ == '__main__':
    unittest.main()
