import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "tools/tg/connection_identities.py"
spec = importlib.util.spec_from_file_location("connection_identities", PATH)
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)
connections = identity.connections


def node_identity(provider_id, title_en, title_ja="", title_romaji="", year=2020, fmt="TV"):
    return {
        "id": provider_id, "type": "ANIME", "titleEn": title_en,
        "titleJa": title_ja, "titleRomaji": title_romaji,
        "year": year, "format": fmt, "cover": "", "providerId": provider_id,
    }


def cache_entry(provider_id, title_en, title_ja="", title_romaji="", year=2020, fmt="TV",
                relations=None, checked_at="2026-10-30T00:00:00+00:00", sources=None):
    return {
        "sourceUrl": f"https://anilist.co/anime/{provider_id}",
        "checkedAt": checked_at,
        "identity": node_identity(provider_id, title_en, title_ja, title_romaji, year, fmt),
        "sources": [] if sources is None else sources,
        "relations": relations or [],
        "recommendations": [],
    }


def document(*entries):
    return {"entries": {str(entry["identity"]["providerId"]): entry for entry in entries}}


def edge(kind, target_entry):
    return {"relationType": kind, "node": {
        key: target_entry["identity"][key] for key in ("id", "type", "titleEn", "titleJa", "titleRomaji", "year", "format", "cover")
    }}


class TitleIdentityTests(unittest.TestCase):
    def test_normalization_preserves_season_part_and_roman_markers(self):
        self.assertEqual(identity.normalize_title("Re:ZERO -Starting Life- Season 3"),
                         "re zero starting life season 3")
        self.assertNotEqual(identity.normalize_title("Show 2nd Season"),
                            identity.normalize_title("Show 3rd Season"))
        self.assertNotEqual(identity.normalize_title("Show II"),
                            identity.normalize_title("Show III"))
        self.assertNotEqual(identity.normalize_title("Show Part 2"),
                            identity.normalize_title("Show Part 1"))
        self.assertTrue(identity.has_season_marker("Show 2nd Season"))
        self.assertTrue(identity.has_season_marker("Re:ゼロから始める異世界生活 4th season"))
        self.assertTrue(identity.has_season_marker("物語 第2期"))
        self.assertFalse(identity.has_season_marker("Show"))

    def test_generic_native_title_does_not_override_distinguishing_english_title(self):
        base = cache_entry(2, "Show", "ショー", "Show", year=2016)
        season = cache_entry(3, "Show Season 2", "ショー 2nd Season", "Show 2nd Season", year=2020)
        doc = document(base, season)
        index = identity.build_node_index(doc)
        aliases = identity.build_alias_index(index)
        row = {"titleEn": "Show Season 2", "titleJa": "ショー", "year": 2020, "format": "TV", "type": "سریال"}
        match, reason = identity.match_identity(row, index, aliases, {2, 3}, enforce_fresh=True)
        self.assertEqual(reason, "ok")
        self.assertEqual(match["providerId"], 3)

    def test_unknown_year_generic_title_is_never_bound(self):
        doc = document(cache_entry(2, "Show", "ショー", "Show", year=2020))
        index = identity.build_node_index(doc)
        row = {"titleEn": "Show", "titleJa": "ショー", "year": 0, "format": "TV", "type": "سریال"}
        match, reason = identity.match_identity(
            row, index, identity.build_alias_index(index), {2}, enforce_fresh=True)
        self.assertIsNone(match)
        self.assertEqual(reason, "unknown-year-generic")

    def test_unknown_year_season_title_requires_a_fresh_full_entry(self):
        doc = document(cache_entry(2, "Show 2nd Season", "ショー 2nd Season", "Show Second Season", year=2020))
        index = identity.build_node_index(doc)
        row = {"titleEn": "Show 2nd Season", "titleJa": "Show 2nd Season", "year": 0,
               "format": "TV", "type": "سریال"}
        match, reason = identity.match_identity(
            row, index, identity.build_alias_index(index), set(), enforce_fresh=True)
        self.assertIsNone(match)
        self.assertEqual(reason, "unknown-year-unfresh")
        match, reason = identity.match_identity(
            row, index, identity.build_alias_index(index), {2}, enforce_fresh=True)
        self.assertEqual(reason, "ok")
        self.assertEqual(match["providerId"], 2)

    def test_ambiguous_title_and_remake_year_conflicts_fail_closed(self):
        doc = document(
            cache_entry(2, "Show 2nd Season", year=2020),
            cache_entry(3, "Show 2nd Season", year=2020),
        )
        index = identity.build_node_index(doc)
        aliases = identity.build_alias_index(index)
        row = {"titleEn": "Show 2nd Season", "titleJa": "Show 2nd Season", "year": 2020,
               "format": "TV", "type": "سریال"}
        match, reason = identity.match_identity(row, index, aliases, {2, 3}, enforce_fresh=True)
        self.assertIsNone(match)
        self.assertEqual(reason, "ambiguous-provider")

        remake_doc = document(
            cache_entry(2, "Show", year=2020),
            cache_entry(3, "Show", year=2025),
        )
        remake_index = identity.build_node_index(remake_doc)
        remake_row = {"titleEn": "Show", "titleJa": "Show", "year": 2025,
                      "format": "TV", "type": "سریال"}
        match, reason = identity.match_identity(
            remake_row, remake_index, identity.build_alias_index(remake_index),
            {2, 3}, enforce_fresh=True)
        self.assertEqual(reason, "ok")
        self.assertEqual(match["providerId"], 3)

    def test_year_and_format_conflicts_are_rejected(self):
        doc = document(cache_entry(2, "Show", year=2020, fmt="TV"))
        index = identity.build_node_index(doc)
        aliases = identity.build_alias_index(index)
        year_row = {"titleEn": "Show", "titleJa": "Show", "year": 2026,
                    "format": "TV", "type": "سریال"}
        self.assertEqual(identity.match_identity(year_row, index, aliases, {2})[1], "year-conflict")
        movie_row = {"titleEn": "Show", "titleJa": "Show", "year": 2020,
                     "format": "MOVIE", "type": "فیلم"}
        self.assertEqual(identity.match_identity(movie_row, index, aliases, {2})[1], "format-conflict")

    def test_duplicate_local_provider_bindings_are_not_written(self):
        doc = document(cache_entry(2, "Show", year=2020))
        results = [
            {"row": {"slug": "show-a", "titleEn": "Show", "titleJa": "Show", "year": 2020,
                     "format": "TV", "type": "سریال"}, "explicit": None, "conflict": False,
             "match": {"providerId": 2, "evidence": {}}, "reason": "ok"},
            {"row": {"slug": "show-b", "titleEn": "Show", "titleJa": "Show", "year": 2020,
                     "format": "TV", "type": "سریال"}, "explicit": None, "conflict": False,
             "match": {"providerId": 2, "evidence": {}}, "reason": "ok"},
        ]
        bindings, unresolved = identity.build_bindings(results)
        self.assertEqual(bindings, {})
        self.assertEqual(unresolved["duplicate-local-provider"], 2)

    def test_series_without_a_format_cannot_borrow_a_movie_identity(self):
        self.assertFalse(identity._format_compatible({'type': 'سریال', 'format': ''}, {'format': 'MOVIE'}))
        self.assertFalse(identity._format_compatible({'type': 'سریال', 'format': 'TV'}, {'format': ''}))
        self.assertTrue(identity._format_compatible({'type': 'سریال', 'format': ''}, {'format': 'TV'}))


class SupportGraphTests(unittest.TestCase):
    def test_external_node_on_a_local_bridge_is_kept_and_unrelated_is_dropped(self):
        first = cache_entry(11, "Show 2nd Season", year=2020)
        bridge = cache_entry(99, "Show 2nd Season Part 2", year=2021)
        second = cache_entry(12, "Show 3rd Season", year=2022)
        unrelated = cache_entry(88, "Different Show", year=2019)
        first["relations"] = [edge("SEQUEL", bridge)]
        bridge["relations"] = [edge("PREQUEL", first), edge("SEQUEL", second)]
        second["relations"] = [edge("PREQUEL", bridge)]
        entries = {str(item["identity"]["providerId"]): item for item in (first, bridge, second, unrelated)}
        self.assertEqual(identity.bridge_support_ids({11, 12}, entries), {99})

    def test_truncated_or_non_prequel_edges_are_ignored(self):
        first = cache_entry(11, "Show", year=2020)
        second = cache_entry(12, "Show", year=2022)
        first["relations"] = [edge("SPIN_OFF", second)]
        entries = {str(item["identity"]["providerId"]): item for item in (first, second)}
        self.assertEqual(identity.bridge_support_ids({11, 12}, entries), set())


class RefreshWorkerTests(unittest.TestCase):
    def test_worker_binds_an_unknown_year_season_only_after_fetching_its_entry(self):
        now = time.time()
        checked_at = connections.iso_now(now)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "src/lib").mkdir(parents=True)
            (root / "data").mkdir()
            current = {
                "slug": "current", "titleEn": "Current Show", "titleJa": "現在",
                "year": 2020, "format": "TV", "type": "سریال",
            }
            target = {
                "slug": "target", "titleEn": "Current Show 2nd Season",
                "titleJa": "現在 2nd Season", "year": 0, "format": "TV", "type": "سریال",
            }
            metadata = {"current": {
                "identity": {"titleEn": "Current Show", "titleJa": "現在"},
                "providerId": 1, "data": {"year": 2020},
            }}
            old_connections = document(cache_entry(
                1, "Current Show", "現在", year=2020, checked_at=checked_at,
                relations=[edge("SEQUEL", cache_entry(2, "Current Show 2nd Season", "現在 2nd Season", year=2020))],
            ))
            fetched = []

            def fake_fetch(ids, blocked_until=0, budget_end=0):
                fetched.extend(ids)
                media = []
                for provider_id in ids:
                    if provider_id == 2:
                        media.append({
                            "id": 2, "type": "ANIME", "format": "TV", "seasonYear": 2020,
                            "title": {"english": "Current Show 2nd Season",
                                      "native": "現在 2nd Season",
                                      "romaji": "Current Show 2nd Season"},
                            "coverImage": {"large": ""}, "relations": {"edges": []},
                            "recommendations": {"nodes": []},
                        })
                return media, "ok", 0

            with patch.object(connections, "fetch_batch", side_effect=fake_fetch):
                report = identity.refresh_connection_data(
                    [current, target], root, metadata=metadata, overrides={},
                    old_connections=old_connections,
                    old_identities={"version": 1, "bindings": {}},
                    max_requests=3, time_budget=30, now=now,
                )
            self.assertIn(2, fetched)
            self.assertEqual(report["identityBindings"], 1)
            written = json.loads((root / "src/lib/generated-connection-identities.json").read_text())
            self.assertEqual(written["bindings"]["target"]["providerId"], 2)
            cache = json.loads((root / "src/lib/generated-connections.json").read_text())
            self.assertEqual(cache["entries"]["2"]["sources"][0]["titleEn"], "Current Show 2nd Season")
            self.assertFalse(cache["entries"]["2"].get("support"))
            with patch.object(connections, "fetch_batch", side_effect=AssertionError('Unchanged identities must not refetch providers')):
                repeated = identity.refresh_connection_data(
                    [target, current], root, metadata=metadata, overrides={}, now=now + 60,
                )
            self.assertEqual(repeated['status'], 'fresh')
            self.assertEqual(repeated['attempted'], 0)


if __name__ == "__main__":
    unittest.main()
