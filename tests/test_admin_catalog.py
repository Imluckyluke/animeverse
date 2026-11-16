from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from admin_catalog import apply_overrides
import publish_catalog


class AdminCatalogTests(unittest.TestCase):
    def rows(self):
        return [{'slug': 'example', 'titleEn': 'Original', 'score': 8, 'scoreSource': 'mal', 'episodes': 12,
                 'episodeData': [{'number': number, 'qualities': [{'label': '720p', 'url': 'https://t.me/testanivers/' + str(number), 'status': 'done'}]} for number in [2, 3]],
                 'indexedCount': 2, 'availableEpisodes': 2, 'readyCount': 2, 'highestEpisode': 3}]

    def test_public_overlays_do_not_modify_source_or_invent_downloads(self):
        rows = self.rows()
        original = deepcopy(rows)
        overrides = {'example': {'revision': 1, 'patch': {'titleEn': 'Edited', 'editorScore': 4,
                     'episodeHidden': {'3|720p': True}}}}
        result = apply_overrides(rows, overrides)
        self.assertEqual(rows, original)
        self.assertEqual(result[0]['titleEn'], 'Edited')
        self.assertEqual(result[0]['scoreSource'], 'admin')
        self.assertEqual(result[0]['readyCount'], 1)
        self.assertEqual(result[0]['highestEpisode'], 2)
        self.assertEqual(result[0]['episodes'], 12)
        overrides['example']['patch']['episodeHidden']['2|720p'] = True
        self.assertEqual(apply_overrides(rows, overrides), [])

    def test_hidden_titles_do_not_survive_as_demo_rows(self):
        self.assertEqual(apply_overrides(self.rows(), {'example': {'patch': {'hidden': True}}}), [])
        with self.assertRaises(RuntimeError):
            publish_catalog.validate_catalog([])
        publish_catalog.validate_catalog([], allow_empty=True)

    def test_unverified_publish_can_never_acknowledge_admin_success(self):
        with self.assertRaises(RuntimeError):
            publish_catalog.acknowledge_admin({'state': 'building'}, [], Path('/unused'), {'commands': []})
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'src/lib').mkdir(parents=True)
            (root / 'data').mkdir()
            (root / 'src/lib/admin-public-overrides.json').write_text(json.dumps({'overrides': {'example': {'revision': 2}}}))
            with patch.object(publish_catalog, 'DATA', root / 'data'):
                publish_catalog.acknowledge_admin({'state': 'verified', 'deploymentId': 'test'}, [], root, {'commands': []})
            value = json.loads((root / 'data/admin-published-catalog.json').read_text())
            self.assertEqual(value['slugs'], [])
            self.assertEqual(value['revisions']['example'], 2)


if __name__ == '__main__':
    unittest.main()
