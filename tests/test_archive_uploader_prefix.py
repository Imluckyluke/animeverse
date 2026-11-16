import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from backfill import parse_archive_fields


class ArchiveUploaderPrefixTests(unittest.TestCase):
    def test_known_filename_prefix_is_not_an_anime_title(self):
        record = parse_archive_fields(
            'MrAnime_pw_Kono_Subarashii_Sekai_ni_Shukufuku_wo!_2_01_480p.mkv', '', 1)
        self.assertEqual(record['title'], 'Kono Subarashii Sekai ni Shukufuku wo! 2')
        self.assertEqual(record['episode'], 1)
        self.assertEqual(record['quality'], '480p')


if __name__ == '__main__':
    unittest.main()
