import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
import artwork
import banners
from PIL import Image


def image(size):
    out = io.BytesIO()
    Image.new('RGB', size, 'navy').save(out, 'PNG')
    return out.getvalue()


class BannerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for folder in ['src/lib', 'public/covers/catalog', 'data']:
            (self.root / folder).mkdir(parents=True)
        (self.root / 'src/lib/artwork-overrides.ts').write_text('')
        (self.root / 'src/lib/real-catalog.json').write_text('[]')
        self.path = self.root / 'public/covers/catalog/test.webp'
        self.path.write_bytes(image((300, 450)))
        self.row = dict(slug='test', titleEn='Test', year=2024, type='سریال', format='TV', season='بهار', banner='/covers/catalog/test.webp')
        self.candidate = dict(id=123, type='ANIME', format='TV', seasonYear=2024, season='SPRING', startDate={'year': 2024}, title={'english': 'Test'}, bannerImage='https://s4.anilist.co/file/anilistcdn/media/anime/banner/test.jpg')
        self.search = patch.object(banners, 'search', return_value=[self.candidate]).start()
        self.download = patch.object(artwork, 'request_bytes', return_value=image((1600, 400))).start()
        self.addCleanup(patch.stopall)
        self.interval = patch.object(artwork, 'INTERVAL', 0).start()

    def run_worker(self, row=None):
        return banners.enrich([row or self.row], 3, self.root)

    def test_requires_genuine_landscape_and_good_dimensions(self):
        for size in [(400, 600), (900, 300), (1600, 200), (4000, 400), None]:
            self.assertFalse(banners.suitable(size))
        for size in [(1000, 300), (1600, 337), (1920, 1080)]:
            self.assertTrue(banners.suitable(size))

    def test_only_trusted_anime_banner_urls(self):
        self.assertTrue(banners.safe_url(self.candidate['bannerImage']))
        for url in ['http://s4.anilist.co/file/anilistcdn/media/anime/banner/x.jpg', 'https://evil.test/x', 'https://s4.anilist.co/file/anilistcdn/media/manga/banner/x.jpg', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/x.jpg']:
            self.assertFalse(banners.safe_url(url))

    def test_preserves_aspect_ratio_and_never_enlarges_or_crops(self):
        art, variant = banners.build_assets(image((1500, 400)), 'test', 123, self.root)
        with Image.open(self.root / 'public' / art['banner'].lstrip('/')) as output:
            self.assertEqual(output.size, (1500, 400))
        self.assertIn('1500w', variant['srcSet'])
        self.assertNotIn('1920w', variant['srcSet'])
        with self.assertRaises(ValueError):
            banners.build_assets(image((400, 600)), 'test', 123, self.root)

    def test_replaces_once_and_caches_without_changing_original(self):
        old = self.path.read_bytes()
        self.assertEqual(self.run_worker(), {'attempted': 1, 'replaced': 1})
        self.assertEqual(self.run_worker(), {'attempted': 0, 'replaced': 0})
        self.search.assert_called_once()
        self.assertEqual(self.path.read_bytes(), old)
        output = json.loads((self.root / 'src/lib/generated-banners.json').read_text())
        self.assertIn('test', output['artwork'])

    def test_wrong_season_and_missing_banner_leave_original(self):
        self.candidate['startDate']['year'] = 2023
        self.assertEqual(self.run_worker()['replaced'], 0)
        self.download.assert_not_called()
        self.assertEqual(self.run_worker()['attempted'], 0)

    def test_valid_local_widescreen_never_queried(self):
        self.path.write_bytes(image((1600, 400)))
        self.assertEqual(self.run_worker()['attempted'], 0)
        self.search.assert_not_called()

    def test_manual_banner_is_never_overwritten(self):
        self.assertEqual(self.run_worker({**self.row, 'slug': 'witch-hat-atelier'})['attempted'], 0)
        self.search.assert_not_called()

    def test_query_strings_and_traversal(self):
        self.assertEqual(banners.local_path('/covers/catalog/test.webp?v=1', self.root), self.path)
        self.assertIsNone(banners.local_path('/covers/catalog/../../secret', self.root))
        self.assertIsNone(banners.local_path('https://evil.test/x', self.root))

    def test_broken_banner_is_candidate_but_not_a_good_native_banner(self):
        self.path.write_bytes(b'not an image')
        self.assertTrue(banners.needs_banner(self.row, self.root))
        self.assertEqual(self.run_worker()['replaced'], 1)


if __name__ == '__main__':
    unittest.main()
