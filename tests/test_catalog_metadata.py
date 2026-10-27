"""Offline contract regressions; run: python3 -m unittest discover -s tests -p test_catalog_metadata.py"""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "tg"))
from catalog import build_catalog, build_links


class CatalogMetadataTests(unittest.TestCase):
    def setUp(self):
        self.state = {
            "anime": {"test": {
                "slug": "test", "titleEn": "Test", "updatedAt": "2026-10-20T12:00:00Z",
                "lastPostId": 123, "episodes": {"2": {"720p": "metadata-link"},
                                               "7": {"1080p": "archive-link"}},
            }},
            "queue": {
                "metadata-link": {"status": "done", "url": "https://example.org/2"},
                "archive-link": {"status": "done", "source": "archive", "url": "https://example.org/7"},
            },
        }
        self.anime = self.state["anime"]["test"]

    def row(self):
        return build_catalog(self.state)[0]

    def test_unknown_is_not_fabricated(self):
        row = self.row()
        self.assertEqual((row["score"], row["scoreSource"], row["scoreReportedVia"]), (0, "unknown", "aniplus"))
        self.assertEqual((row["votes"], row["weeklyViews"], row["popularity"]), (0, 0, 0))
        self.assertEqual((row["year"], row["duration"]), (0, ""))
        self.assertNotIn("rank", row)
        self.assertTrue(all(e["releasedAt"] == "" and e["runtime"] == "" for e in row["episodeData"]))

    def test_reported_scores_preserve_value_and_origin(self):
        self.anime.update(scoreMal=8.37, scoreAniplus=9.2)
        self.assertEqual((self.row()["score"], self.row()["scoreSource"]), (8.37, "mal"))
        del self.anime["scoreMal"]
        self.assertEqual((self.row()["score"], self.row()["scoreSource"]), (9.2, "aniplus"))

    def test_bad_scores_not_clamped(self):
        for value in [None, "", "invalid", True, -2, 0, 4765, float("nan"), float("inf")]:
            with self.subTest(value=value):
                self.anime.update(scoreMal=value, scoreAniplus=value)
                self.assertEqual(self.row()["score"], 0)

    def test_counts_do_not_fill_numbering_gaps(self):
        row = self.row()
        self.assertEqual((row["indexedCount"], row["readyCount"], row["highestEpisode"]), (2, 2, 7))
        self.assertEqual((row["episodes"], row["availableEpisodes"]), (2, 2))
        self.assertNotIn("totalEpisodes", row)

    def test_declared_total_must_cover_highest(self):
        for value in [None, 0, -1, 2, 6, "unknown", True, 12.5]:
            self.anime["declaredEpisodes"] = value
            self.assertNotIn("totalEpisodes", self.row())
        for value in [7, 12, "12"]:
            self.anime["declaredEpisodes"] = value
            self.assertEqual(self.row()["totalEpisodes"], int(value))

    def test_ready_requires_done_and_http_url(self):
        for status, url, expected in [
            ("done", None, 1), ("done", "javascript:alert(1)", 1),
            ("pending", "https://example.org/file", 1), ("failed", "https://example.org/file", 1),
            ("done", "https://", 1), ("done", "https://bad host/file", 1),
            ("done", "http://example.org/file", 2),
        ]:
            with self.subTest(status=status, url=url):
                self.state["queue"]["archive-link"].update(status=status, url=url)
                self.assertEqual(self.row()["readyCount"], expected)

    def test_public_post_provenance_is_not_release_date(self):
        self.anime["postUrl"] = "https://t.me/c/999/12"
        self.anime["sourcePostUrl"] = "https://t.me/+not-public"
        row = self.row()
        self.assertEqual(row["sourcePostUrl"], "https://t.me/aniplus/123")
        self.assertEqual(row["sourcePostAt"], self.anime["updatedAt"])
        self.assertNotIn("not-public", json.dumps(row))
        self.anime["lastPostId"] = 0
        self.assertNotIn("sourcePostUrl", self.row())

    def test_year_and_runtime_use_metadata_not_post_date(self):
        self.anime.update(seasonRaw="نامشخص", year=2026, durationRaw="نامشخص")
        self.assertEqual((self.row()["year"], self.row()["duration"]), (0, ""))
        self.anime.update(seasonRaw="تابستان 2022", durationRaw="24 دقیقه")
        self.assertEqual((self.row()["year"], self.row()["duration"]), (2022, "۲۴ دقیقه"))
        self.anime["seasonRaw"] = "پاییز ۱۴۰۳"
        self.assertEqual(self.row()["year"], 2024)

    def test_both_sources_and_routing_preserved_without_mutation(self):
        before = copy.deepcopy(self.state)
        row = self.row()
        self.assertEqual(row["source"], "aniplus")
        self.assertEqual([e["qualities"][0]["deepLink"] for e in row["episodeData"]], ["metadata-link", "archive-link"])
        self.assertEqual(set(build_links(self.state)), {"test|2|720p", "test|7|1080p"})
        self.assertEqual(self.state, before)

    @unittest.skipUnless(shutil.which("node"), "Node is needed for pure client-helper checks")
    def test_pure_client_helpers_and_real_episode_fallback(self):
        script = r'''
const fs = require("fs"), ts = require("typescript"), assert = require("assert/strict");
function load(file, deps = {}) {
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = {exports: {}};
  new Function("require", "module", "exports", js)((name) => {
    if (name in deps) return deps[name];
    throw new Error("Unexpected runtime dependency: " + name);
  }, module, module.exports);
  return module.exports;
}
const {getEpisodeAvailability: availability, hasReportedScore, getScoreLabel} = load("src/lib/catalog-metadata.ts");
const {getEpisodes} = load("src/lib/catalog.ts", {"./search": {}});
const episode = (number, status, url) => ({number, title: "", runtime: "", releasedAt: "", qualities: [{status, url}]});
const real = {source: "aniplus", episodes: 100, episodeData: [
  episode(2, "done", "https://example.org/a"), episode(7, "done"),
  episode(2, "done", "https://example.org/b"), episode(9, "pending", "https://example.org/c"),
  episode(12, "done", "javascript:alert(1)"), episode(14, "done", "https://bad host/a")
]};
assert.deepEqual(availability(real), {indexedCount: 5, readyCount: 1, highestEpisode: 14, totalEpisodes: null});
assert.equal(availability({...real, totalEpisodes: 12}).totalEpisodes, null);
assert.equal(availability({...real, totalEpisodes: 24}).totalEpisodes, 24);
assert.equal(availability({source: "aniplus", episodes: 100, indexedCount: 3, readyCount: 3}).readyCount, 0);
assert.equal(availability({...real, episodeData: []}).indexedCount, 0);
assert.equal(hasReportedScore({score: 8.5}), false);
assert.equal(hasReportedScore({score: 8.5, scoreSource: "unknown"}), false);
assert.equal(hasReportedScore({score: Infinity, scoreSource: "mal"}), false);
assert.equal(hasReportedScore({score: 8.37, scoreSource: "mal"}), true);
assert.equal(getScoreLabel({score: 8.37, scoreSource: "mal", scoreReportedVia: "aniplus"}), "MAL");
assert.equal(getScoreLabel({score: 8, scoreSource: "aniplus"}), "امتیاز ثبت‌شده");
assert.equal(getScoreLabel({score: 0, scoreSource: "unknown"}), "");
assert.deepEqual(getEpisodes({source: "aniplus", type: "فیلم", episodes: 1}), []);
assert.deepEqual(getEpisodes({source: "aniplus", episodeData: [], episodes: 50}), []);
assert.deepEqual(getEpisodes({slug: "not-an-existing-demo", type: "فیلم", episodes: 1}), []);
assert.equal(getEpisodes(real).length, real.episodeData.length);
for (const source of ["demo", undefined]) {
  assert.equal(getEpisodes({source, slug: "your-name", type: "فیلم", titleEn: "Demo", episodes: 1}).length, 1);
}
console.log("Pure client metadata checks passed");
'''
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
