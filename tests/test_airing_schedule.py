import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "tools/tg/airing_schedule.py"
spec = importlib.util.spec_from_file_location("public_airing_schedule", path)
airing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(airing)

NOW = 1_800_000_000
FUTURE = NOW + 3_600


def row(**overrides):
    return {
        "slug": "example-ii",
        "titleEn": "Example II",
        "titleJa": "例二",
        "year": 2026,
        "format": "TV",
        "type": "سریال",
        **overrides,
    }


def metadata_entry(**overrides):
    return {
        "identity": {"titleEn": "Example II", "titleJa": "例二"},
        "providerId": 99,
        "data": {"year": 2026},
        **overrides,
    }


def snapshot(year=2026):
    return {"titleEn": "Example II", "titleJa": "例二", "year": year}


def media(**overrides):
    value = {
        "id": 99,
        "type": "ANIME",
        "status": "RELEASING",
        "format": "TV",
        "startDate": {"year": 2026},
        "nextAiringEpisode": {"airingAt": FUTURE, "episode": 5},
    }
    value.update(overrides)
    return value


class AiringIdentityTests(unittest.TestCase):
    def constraints(self, current_row=None):
        current_row = current_row or row()
        sources = {99: [snapshot(current_row["year"])]}
        metadata = {current_row["slug"]: metadata_entry()}
        return sources, airing.local_constraints([current_row], metadata, set(), sources)[99]

    def test_only_exact_verified_sources_are_considered(self):
        sources, constraints = self.constraints()
        self.assertEqual(airing.source_identity(media(), 99, sources[99], constraints)["providerId"], 99)
        stale = {99: [snapshot(2020)]}
        self.assertIsNone(airing.source_identity(media(), 99, stale[99], constraints))
        self.assertIsNone(airing.source_identity(media(), 99, sources[99], []))

    def test_hidden_and_metadata_mismatch_do_not_create_sources(self):
        current = row()
        metadata = {"example-ii": metadata_entry()}
        self.assertEqual(len(airing.connections.verified_sources([current], metadata)), 1)
        self.assertEqual(airing.connections.verified_sources([current], metadata, {"example-ii"}), {})
        stale_metadata = {"example-ii": metadata_entry(identity={"titleEn": "Example", "titleJa": "例"})}
        self.assertEqual(airing.connections.verified_sources([current], stale_metadata), {})

    def test_roman_season_year_and_format_mismatches_fail_closed(self):
        sources, constraints = self.constraints()
        self.assertIsNone(airing.source_identity(media(startDate={"year": 2025}), 99, sources[99], constraints))
        self.assertIsNone(airing.source_identity(media(format="OVA"), 99, sources[99], constraints))
        self.assertIsNone(airing.source_identity(media(format="TV_SHORT"), 99, sources[99], constraints))
        movie_row = row(format="MOVIE", type="فیلم")
        movie_sources, movie_constraints = self.constraints(movie_row)
        self.assertIsNone(airing.source_identity(media(format="MOVIE"), 99, movie_sources[99], movie_constraints))

    def test_finished_cancelled_and_non_episodic_formats_never_emit(self):
        sources, constraints = self.constraints()
        for status in ("FINISHED", "CANCELLED", "HIATUS", "UNKNOWN", None):
            self.assertIsNone(airing.source_identity(media(status=status), 99, sources[99], constraints))
        for fmt in ("MOVIE", "OVA", "MUSIC", None):
            self.assertIsNone(airing.source_identity(media(format=fmt), 99, sources[99], constraints))
        self.assertIsNotNone(airing.source_identity(media(status="NOT_YET_RELEASED"), 99, sources[99], constraints))

    def test_timestamps_must_be_real_future_integers(self):
        self.assertEqual(airing.next_episode(media(), NOW), {"episode": 5, "airingAt": "2027-01-15T09:00:00Z"})
        invalid = [
            NOW - 1,
            True,
            False,
            0,
            -1,
            None,
            "1800003600",
            float("inf"),
            float("nan"),
            airing.MAX_EPOCH + 1,
        ]
        for value in invalid:
            self.assertIsNone(airing.next_episode(media(nextAiringEpisode={"airingAt": value, "episode": 5}), NOW))
        for episode in (0, -1, True, "5", None, 2.5):
            self.assertIsNone(airing.next_episode(media(nextAiringEpisode={"airingAt": FUTURE, "episode": episode}), NOW))

    def test_schedule_and_entry_freshness_expire(self):
        sources, constraints = self.constraints()
        entry = airing.entry_from_media(media(), 99, sources[99], constraints, airing.iso_now(NOW), NOW)
        self.assertTrue(airing.entry_is_fresh(entry, 99, sources[99], NOW, 6 * 3600))
        self.assertFalse(airing.entry_is_fresh(entry, 99, sources[99], NOW + 6 * 3600, 6 * 3600))
        self.assertFalse(airing.entry_is_fresh(entry, 99, sources[99], FUTURE + 1, 7 * 3600))

    def test_http_429_deadline_is_honoured_not_slept_through(self):
        error = HTTPError(airing.API_URL, 429, "Too Many Requests", {"Retry-After": "3600"}, io.BytesIO(b"{}"))
        with patch.object(airing.time, "time", return_value=100), \
                patch.object(airing.urllib.request, "urlopen", side_effect=error) as request, \
                patch.object(airing.time, "sleep") as sleep:
            result, status, deadline = airing.fetch_batch([1], budget_end=200)
        self.assertIsNone(result)
        self.assertEqual(status, "rate-limited")
        self.assertEqual(deadline, 3700)
        self.assertEqual(request.call_count, 1)
        sleep.assert_not_called()

    def test_generated_file_is_public_metadata_only(self):
        raw = (ROOT / "src/lib/generated-airing.json").read_text()
        value = json.loads(raw)
        self.assertEqual(value.get("provider"), "anilist")
        for forbidden in ("chatId", "deepLink", "session", "password", "botToken", "destination_id"):
            self.assertNotIn('"' + forbidden + '"', raw)

    def test_short_rate_wait_also_stays_durable_without_inline_retry(self):
        error = HTTPError(airing.API_URL, 429, 'Too Many Requests', {'Retry-After': '2'}, io.BytesIO(b'{}'))
        with patch.object(airing.time, 'time', return_value=100), patch.object(airing.urllib.request, 'urlopen', side_effect=error) as request, patch.object(airing.time, 'sleep') as sleep:
            result, status, deadline = airing.fetch_batch([1], budget_end=200)
        self.assertEqual((result, status, deadline), (None, 'rate-limited', 102))
        self.assertEqual(request.call_count, 1)
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
