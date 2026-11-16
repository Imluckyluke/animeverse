from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from archive_identity import NUMBERING_VARIANTS, choose_identity


class NumberingVersionTests(unittest.TestCase):
    def test_a_compact_numbered_set_cannot_silently_become_broadcast_numbering(self):
        for ident, (total, compact) in NUMBERING_VARIANTS.items():
            media = {'id': ident, 'title': {'romaji': 'Example'}, 'format': 'TV', 'status': 'FINISHED',
                     'episodes': total, 'startDate': {'year': 2020}}
            record = {'id': 1, 'title': 'Example', 'episode': compact, 'name': f'Example - {compact:02} [720p].mkv', 'quality': '720p'}
            chosen, reason = choose_identity('Example', [record], [media])
            self.assertIsNone(chosen)
            self.assertEqual(reason, 'numbering-version-needs-file-review')
            # This evidence is regenerated against the live peer document by
            # the sole-writer proposal consumer, not supplied by captions.
            trusted = {**record, 'documentIdentityEvidence': {'providerId': ident, 'basis': 'identical-document-id-filename-size'}}
            self.assertEqual(choose_identity('Example', [trusted], [media])[0]['id'], ident)
            forged_target = {**trusted, 'documentIdentityEvidence': {'providerId': ident + 1, 'basis': 'identical-document-id-filename-size'}}
            self.assertIsNone(choose_identity('Example', [forged_target], [media])[0])


if __name__ == '__main__': unittest.main()
