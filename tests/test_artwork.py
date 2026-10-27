"""No live network: identity, caching, safety, and atomic publication tests."""
import ast
import asyncio
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools/tg"))
import artwork
from PIL import Image


def image_bytes(size=(800, 1200)):
    handle = io.BytesIO()
    Image.new("RGB", size, "navy").save(handle, "PNG")
    return handle.getvalue()


def row(**changes):
    return dict(slug="test-anime", titleEn="Test Anime", year=2024,
                season="بهار", format="TV", cover="/covers/aniplus/1.jpg", **changes)


def candidate():
    return {"id": 42, "type": "ANIME", "format": "TV", "season": "SPRING",
            "seasonYear": 2024, "startDate": {"year": 2024},
            "title": {"english": "Test Anime", "romaji": "Tesuto Anime"},
            "synonyms": [], "coverImage": {"extraLarge":
                "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/test.jpg"}}


class IdentityTests(unittest.TestCase):
    def test_missing_broadcast_format_still_respects_movie_series_and_special_identity(self):
        local = {**row(), "format": "", "type": "OVA"}
        self.assertIsNone(artwork.select_match(local, [candidate()]))
        special = {**candidate(), "format": "SPECIAL"}
        self.assertIsNotNone(artwork.select_match(local, [special]))
        local["type"] = "سریال"
        self.assertIsNone(artwork.select_match(local, [special]))

    def test_exact_and_provider_alias(self):
        self.assertEqual(artwork.select_match(row(), [candidate()])["id"], 42)
        item = candidate()
        item["synonyms"] = ["Test Anime"]
        item["title"] = {"english": "Alternative"}
        self.assertIsNotNone(artwork.select_match(row(), [item]))

    def test_wrong_year_season_format_manga_and_ambiguous(self):
        for field, value in (("type", "MANGA"), ("format", "MOVIE"), ("season", "FALL"),
                             ("startDate", {"year": 2023})):
            item = candidate()
            item[field] = value
            self.assertIsNone(artwork.select_match(row(), [item]), field)
        second = candidate()
        second["id"] = 43
        self.assertIsNone(artwork.select_match(row(), [candidate(), second]))

    def test_missing_year_and_fuzzy_rejected(self):
        item = row()
        item["year"] = 0
        self.assertIsNone(artwork.select_match(item, [candidate()]))
        item = row()
        item["titleEn"] = "Test Anime New Arc"
        self.assertIsNone(artwork.select_match(item, [candidate()]))

    def test_unknown_year_requires_two_canonical_titles_not_synonyms(self):
        local = row()
        local.update(year=0, titleJa="テストアニメ")
        item = candidate()
        item["title"]["native"] = local["titleJa"]
        self.assertIsNotNone(artwork.select_match(local, [item]))
        item["title"].pop("native")
        item["synonyms"] = [local["titleJa"]]
        self.assertIsNone(artwork.select_match(local, [item]))

    def test_wrong_season_alias_and_part_rejected(self):
        for title in ("Test Anime Season 2", "Test Anime II", "Test Anime 2", "Test Anime Part 2"):
            item = candidate()
            item["title"]["english"] = title
            item["synonyms"] = ["Test Anime"]
            self.assertIsNone(artwork.select_match(row(), [item]), title)
        local = row()
        local["titleEn"] = "Test Anime Season 2"
        item = candidate()
        item["synonyms"] = [local["titleEn"]]
        self.assertIsNone(artwork.select_match(local, [item]))

    def test_matching_season_two(self):
        local = row()
        local["titleEn"] = "Test Anime Season 2"
        item = candidate()
        item["title"]["english"] = local["titleEn"]
        self.assertIsNotNone(artwork.select_match(local, [item]))


class AssetTests(unittest.TestCase):
    def test_variants_webp_no_enlargement_and_actual_srcset(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            art, variants = artwork.build_assets(image_bytes((460, 690)), "test", 42, (200, 300), root)
            files = list((root / "public/covers/enriched").glob("*.webp"))
            self.assertEqual(len(files), 4)
            for path in files:
                with Image.open(path) as image:
                    self.assertEqual(image.format, "WEBP")
                    self.assertLessEqual(image.width, 460)
                    self.assertLessEqual(image.height, 690)
            self.assertIn("460w", variants["srcSet"])
            self.assertNotIn("640w", variants["srcSet"])
            self.assertTrue((root / "public" / art["cover"].lstrip("/")).is_file())

    def test_low_resolution_bad_bytes_and_unsafe_slug_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for raw, slug in ((image_bytes((200, 300)), "test"), (b"not an image", "test"),
                              (image_bytes(), "../escape"), (image_bytes((1200, 800)), "test")):
                with self.assertRaises((ValueError, OSError)):
                    artwork.build_assets(raw, slug, 42, (200, 300), root)
            self.assertFalse((root / "public").exists())

    def test_provider_extralarge_must_be_genuinely_larger(self):
        with tempfile.TemporaryDirectory() as folder:
            # AniList's name extraLarge is not a pixel guarantee. 460px may
            # improve a 225px original, but not sufficiently improve 385x600.
            with self.assertRaises(ValueError):
                artwork.build_assets(image_bytes((460, 650)), "test", 42, (385, 600), Path(folder))
            self.assertFalse((Path(folder) / "public").exists())

    def test_only_allowlisted_https_images_no_redirects(self):
        for url in ("http://s4.anilist.co/file/anilistcdn/media/anime/cover/a.jpg",
                    "https://127.0.0.1/a.jpg", "https://s4.anilist.co.evil.test/a.jpg",
                    "https://s4.anilist.co/file/anilistcdn/media/manga/cover/a.jpg",
                    "https://user:pass@s4.anilist.co/file/anilistcdn/media/anime/cover/a.jpg"):
            with patch.object(artwork, "request_bytes") as request:
                with self.assertRaises(ValueError):
                    artwork.download(url)
                request.assert_not_called()
        with self.assertRaises(ValueError):
            artwork.NoRedirect().redirect_request(None, None, 302, "", {}, "http://localhost")

    def test_download_size_bound(self):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value = response
        response.headers = {"Content-Length": "999"}
        opener = unittest.mock.MagicMock()
        opener.open.return_value = response
        with patch.object(artwork.urllib.request, "build_opener", return_value=opener):
            with self.assertRaises(ValueError):
                artwork.request_bytes(None, 100)
            response.read.assert_not_called()
            response.headers = {}
            response.read.return_value = b"x" * 101
            with self.assertRaises(ValueError):
                artwork.request_bytes(None, 100)
            response.read.assert_called_with(101)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "src/lib").mkdir(parents=True)
        (self.root / "src/lib/artwork-overrides.ts").write_text('"manual-anime": { cover: "/covers/custom.webp" }')
        cover = self.root / "public/covers/aniplus/1.jpg"
        cover.parent.mkdir(parents=True)
        cover.write_bytes(image_bytes((200, 300)))
        self.original = cover.read_bytes()
        self.search = patch.object(artwork, "search", return_value=[candidate()]).start()
        self.download = patch.object(artwork, "download", return_value=image_bytes()).start()
        patch.object(artwork.time, "sleep").start()

    def tearDown(self):
        patch.stopall()
        self.temp.cleanup()

    def run_worker(self, rows=None, limit=3):
        return artwork.enrich(rows or [row()], limit, self.root)

    def test_success_is_cached_and_original_preserved(self):
        self.assertEqual(self.run_worker()["replaced"], 1)
        self.assertEqual(self.run_worker()["attempted"], 0)
        self.search.assert_called_once()
        self.assertEqual((self.root / "public/covers/aniplus/1.jpg").read_bytes(), self.original)
        generated = json.loads((self.root / "src/lib/generated-artwork.json").read_text())
        self.assertEqual(set(generated), {"artwork", "variants"})

    def catalogue_cover(self, content=None):
        cover = self.root / "public/covers/catalog/test.jpg"
        cover.parent.mkdir(parents=True, exist_ok=True)
        cover.write_bytes(content if content is not None else image_bytes((225, 311)))
        local = row()
        local["cover"] = "/covers/catalog/test.jpg?v=1"
        return local, cover

    def test_catalogue_low_resolution_is_replaced_and_resumable(self):
        local, cover = self.catalogue_cover()
        original = cover.read_bytes()
        self.assertEqual(artwork.local_cover(local, self.root), cover)
        self.assertEqual(self.run_worker([local])["replaced"], 1)
        self.assertEqual(self.run_worker([local])["attempted"], 0)
        self.assertEqual(cover.read_bytes(), original)

    def test_corrupt_existing_catalogue_image_uses_zero_dimensions(self):
        local, cover = self.catalogue_cover(b"corrupt")
        self.assertIsNone(artwork.dimensions(cover))
        self.assertTrue(artwork.poor(None))
        with patch.object(artwork, "build_assets", wraps=artwork.build_assets) as build:
            self.assertEqual(self.run_worker([local])["replaced"], 1)
            self.assertEqual(build.call_args.args[3], (0, 0))
        self.assertEqual(cover.read_bytes(), b"corrupt")

    def test_catalogue_manual_overrides_and_missing_files_are_skipped(self):
        local, _ = self.catalogue_cover()
        for changes in ({"slug": "manual-anime"}, {"slug": "witch-hat-atelier"},
                        {"artworkOverride": True}, {"coverOverride": "/covers/manual.webp"},
                        {"cover": "/covers/catalog/missing.jpg"},
                        {"cover": "/covers/enriched/test.webp"}):
            self.assertEqual(self.run_worker([{**local, **changes}])["attempted"], 0)
        self.search.assert_not_called()

    def test_catalogue_traversal_and_symlink_escape_are_rejected(self):
        local, _ = self.catalogue_cover()
        for url in ("/covers/catalog/../catalog/test.jpg", "/covers/catalog/%2e%2e/test.jpg",
                    "/covers/catalog/../../other.jpg", "/covers/catalog/..\\test.jpg",
                    "//evil.test/covers/catalog/test.jpg", "https://evil.test/covers/catalog/test.jpg"):
            self.assertIsNone(artwork.local_cover({**local, "cover": url}, self.root), url)
        outside = self.root / "outside.jpg"
        outside.write_bytes(image_bytes())
        link = self.root / "public/covers/catalog/link.jpg"
        link.symlink_to(outside)
        self.assertIsNone(artwork.local_cover({**local, "cover": "/covers/catalog/link.jpg"}, self.root))

    def test_old_catalogue_rows_retained_and_current_metadata_wins(self):
        path = self.root / "src/lib/real-catalog.json"
        path.write_text(json.dumps([row(), {**row(), "slug": "old-catalogue"}]))
        current = {**row(), "year": 2025}
        rows = artwork.catalogue_rows([current], self.root)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["year"], 2025)
        self.assertEqual(rows[1]["slug"], "old-catalogue")

    def test_no_match_and_error_cached(self):
        self.search.return_value = []
        self.assertEqual(self.run_worker()["replaced"], 0)
        self.assertEqual(self.run_worker()["attempted"], 0)
        self.download.assert_not_called()
        local = row()
        local["slug"] = "other"
        self.search.side_effect = TimeoutError()
        self.assertEqual(self.run_worker([local])["attempted"], 1)
        self.assertEqual(self.run_worker([local])["attempted"], 0)
        cache = json.loads((self.root / "data/artwork-cache.json").read_text())
        self.assertEqual(cache["entries"]["other"]["status"], "error")

    def test_limit_and_resume(self):
        self.search.return_value = []
        rows = []
        for i in range(4):
            local = row()
            local["slug"] = f"anime-{i}"
            rows.append(local)
        self.assertEqual(self.run_worker(rows, 2)["attempted"], 2)
        self.assertEqual(self.run_worker(rows, 2)["attempted"], 2)
        self.assertEqual(self.run_worker(rows, 2)["attempted"], 0)
        self.assertEqual(self.search.call_count, 4)

    def test_curated_manual_remote_traversal_and_good_covers_skipped(self):
        rows = []
        for slug in ("witch-hat-atelier", "manual-anime"):
            local = row()
            local["slug"] = slug
            rows.append(local)
        for url in ("https://example.org/cover.jpg", "/covers/aniplus/../../other.jpg", "/covers/curated/a.webp"):
            local = row()
            local["cover"] = url
            rows.append(local)
        self.assertEqual(self.run_worker(rows)["attempted"], 0)
        self.search.assert_not_called()
        (self.root / "public/covers/aniplus/1.jpg").write_bytes(image_bytes())
        self.assertEqual(self.run_worker()["attempted"], 0)

    def test_bad_download_does_not_publish(self):
        self.download.return_value = image_bytes((220, 330))
        self.assertEqual(self.run_worker()["replaced"], 0)
        self.assertFalse((self.root / "src/lib/generated-artwork.json").exists())
        self.assertEqual((self.root / "public/covers/aniplus/1.jpg").read_bytes(), self.original)

    def test_atomic_write_failure_keeps_old_map(self):
        target = self.root / "src/lib/generated-artwork.json"
        target.write_text('{"artwork": {}, "variants": {}}')
        before = target.read_bytes()
        with patch.object(artwork.os, "replace", side_effect=OSError("disk")):
            with self.assertRaises(OSError):
                artwork.atomic_json(target, {"bad": True})
        self.assertEqual(target.read_bytes(), before)
        self.assertFalse(list(target.parent.glob(".artwork-*")))


def load_function(filename, name, namespace):
    """Exercise actual worker functions without importing Telegram/secrets config."""
    path = Path(__file__).resolve().parents[1] / "tools/tg" / filename
    tree = ast.parse(path.read_text())
    node = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == name)
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"), namespace)
    return namespace[name]


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.metadata_patch = patch("metadata.enrich", return_value={"attempted": 0, "replaced": 0})
        self.metadata_patch.start()
        self.addCleanup(self.metadata_patch.stop)
        self.banner_patch = patch("banners.enrich", return_value={"attempted": 0, "replaced": 0})
        self.banner_patch.start()
        self.addCleanup(self.banner_patch.stop)

    def test_metadata_only_changes_trigger_a_catalogue_rebuild(self):
        catalogue = types.ModuleType("catalog")
        catalogue.build_catalog = Mock(return_value=[])
        prepare = load_function("ingest.py", "prepare_covers", {
            "Any": object, "asyncio": asyncio, "PUBLIC_COVERS": Path("unused"),
            "safe_key": lambda key: key, "check_stop": Mock(), "ensure_cover": Mock(), "save_state": Mock(),
        })
        with patch.dict(sys.modules, {"catalog": catalogue}), \
                patch.object(artwork, "catalogue_rows", return_value=[]), \
                patch.object(artwork, "enrich", return_value={"attempted": 0, "replaced": 0}), \
                patch("metadata.enrich", return_value={"attempted": 1, "replaced": 1}):
            self.assertEqual(asyncio.run(prepare({"anime": {}}, Mock())), 1)

    def test_failed_unchanged_source_cover_does_not_trigger_rebuild(self):
        catalogue = types.ModuleType("catalog")
        catalogue.build_catalog = Mock(return_value=[])
        with tempfile.TemporaryDirectory() as folder:
            url = "https://example.org/cover.jpg"
            state = {"anime": {"one": {"mediaKey": "one", "coverUrl": url, "cover": url, "banner": url}}}
            namespace = {"Any": object, "asyncio": asyncio, "PUBLIC_COVERS": Path(folder),
                         "safe_key": lambda key: key, "check_stop": Mock(),
                         "ensure_cover": Mock(return_value=None), "save_state": Mock()}
            prepare = load_function("ingest.py", "prepare_covers", namespace)
            with patch.dict(sys.modules, {"catalog": catalogue}), \
                    patch.object(artwork, "catalogue_rows", return_value=[]), \
                    patch.object(artwork, "enrich", return_value={"attempted": 0, "replaced": 0}):
                self.assertEqual(asyncio.run(prepare(state, Mock())), 0)
                namespace["ensure_cover"].assert_called_once()

    def test_prepare_covers_returns_enrichment_changes_without_original_downloads(self):
        catalogue = types.ModuleType("catalog")
        catalogue.build_catalog = Mock(return_value=[])
        namespace = {"Any": object, "asyncio": asyncio}
        prepare = load_function("ingest.py", "prepare_covers", namespace)
        with patch.dict(sys.modules, {"catalog": catalogue}), \
                patch.object(artwork, "catalogue_rows", return_value=[]), \
                patch.object(artwork, "enrich", return_value={"attempted": 2, "replaced": 2}):
            self.assertEqual(asyncio.run(prepare({"anime": {}}, Mock())), 2)

    def test_idle_watch_poll_rebuilds_when_only_artwork_changes(self):
        namespace = {"TelegramClient": object, "Status": object, "asyncio": asyncio,
                     "WATCH_INTERVAL": 0, "check_stop": Mock(), "save_state": Mock(),
                     "ingest_new": AsyncMock(side_effect=[(0, 0, 0, []), asyncio.CancelledError()]),
                     "prepare_covers": AsyncMock(return_value=1),
                     "write_catalog": Mock(return_value=([], {})), "rebuild_site": Mock(return_value=True)}
        watch = load_function("sync.py", "_watch_ingest_loop", namespace)

        async def run():
            with self.assertRaises(asyncio.CancelledError):
                await watch(Mock(), {}, Mock(), False, asyncio.Lock())

        asyncio.run(run())
        namespace["prepare_covers"].assert_awaited_once()
        namespace["rebuild_site"].assert_called_once()


if __name__ == "__main__":
    unittest.main()
