import gzip
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "ops"))
from production_ops import (
    SERVICE_UNITS,
    OpsError,
    collect_health_checks,
    create_snapshot_package,
    run_health_check,
    verify_restored_package,
)


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class BackupPackageTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.output = self.root / "package"
        self.restore = self.root / "restore"

    def tearDown(self):
        self.folder.cleanup()

    def database(self, name="archive.sqlite3", value="one"):
        path = self.root / name
        database = sqlite3.connect(path)
        database.execute("PRAGMA journal_mode=WAL")
        database.execute("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT)")
        database.execute("INSERT INTO records (value) VALUES (?)", (value,))
        database.commit()
        return path, database

    def restore_file(self, name):
        self.restore.mkdir(exist_ok=True)
        with gzip.open(self.output / (name + ".gz"), "rb") as source:
            with (self.restore / name).open("wb") as target:
                shutil.copyfileobj(source, target)
        return self.restore / name

    def manifest(self):
        return json.loads((self.output / "manifest.json").read_text())

    def write_manifest(self, payload):
        (self.output / "manifest.json").write_text(json.dumps(payload))

    def test_package_is_consistent_hashed_private_and_verifiable(self):
        database, writer = self.database(value="from wal")
        state = self.root / "state.json"
        state.write_text(json.dumps({"version": 1, "titles": ["one"]}))
        extra, extra_writer = self.database("unrequested.sqlite3", value="not requested")
        try:
            manifest = create_snapshot_package([database], self.output, json_files=[state])
        finally:
            writer.close()
            extra_writer.close()

        self.assertEqual(manifest["format"], "animeverse-backup/v1")
        self.assertEqual([item["name"] for item in manifest["files"]], ["archive.sqlite3", "state.json"])
        self.assertEqual(stat.S_IMODE((self.output / "manifest.json").stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.output / "archive.sqlite3.gz").stat().st_mode), 0o600)
        self.assertNotIn("unrequested.sqlite3", json.dumps(manifest))
        restored_database = self.restore_file("archive.sqlite3")
        restored_state = self.restore_file("state.json")
        self.assertEqual(digest(restored_database), manifest["files"][0]["sha256"])
        self.assertEqual(digest(restored_state), manifest["files"][1]["sha256"])
        report = verify_restored_package(self.output / "manifest.json", self.restore)
        self.assertTrue(report["ok"])
        self.assertEqual(report["files"], {"sqlite": 1, "json": 1})

        with sqlite3.connect(restored_database) as check:
            self.assertEqual(check.execute("SELECT value FROM records").fetchone()[0], "from wal")

    def test_requested_output_directory_must_be_new(self):
        database, writer = self.database()
        try:
            create_snapshot_package([database], self.output)
            with self.assertRaises(OpsError):
                create_snapshot_package([database], self.output)
        finally:
            writer.close()

    def test_duplicate_names_and_directories_are_rejected(self):
        first = self.root / "a"
        second = self.root / "b"
        first.mkdir()
        second.mkdir()
        one, one_writer = self.database("a/queue.sqlite3")
        two, two_writer = self.database("b/queue.sqlite3")
        try:
            with self.assertRaises(OpsError):
                create_snapshot_package([one, two], self.output)
            self.assertFalse(self.output.exists())
            with self.assertRaises(OpsError):
                create_snapshot_package([self.root], self.root / "other")
        finally:
            one_writer.close()
            two_writer.close()

    def test_invalid_requested_json_is_rejected_before_output(self):
        database, writer = self.database()
        state = self.root / "state.json"
        state.write_text("{broken")
        try:
            with self.assertRaises(OpsError):
                create_snapshot_package([database], self.output, json_files=[state])
            self.assertFalse(self.output.exists())
        finally:
            writer.close()

    def test_restored_hash_and_quick_check_are_enforced(self):
        database, writer = self.database()
        try:
            create_snapshot_package([database], self.output)
        finally:
            writer.close()
        restored = self.restore_file("archive.sqlite3")
        original = restored.read_bytes()
        restored.write_bytes(original[:-100])
        with self.assertRaises(OpsError):
            verify_restored_package(self.output / "manifest.json", self.restore)

        manifest = self.manifest()
        broken = b"this is not a sqlite database"
        restored.write_bytes(broken)
        manifest["files"][0]["sha256"] = hashlib.sha256(broken).hexdigest()
        self.write_manifest(manifest)
        with self.assertRaises(OpsError):
            verify_restored_package(self.output / "manifest.json", self.restore)

    def test_restored_json_must_parse(self):
        database, writer = self.database()
        state = self.root / "state.json"
        state.write_text('{"ok": true}')
        try:
            create_snapshot_package([database], self.output, json_files=[state])
        finally:
            writer.close()
        self.restore_file("archive.sqlite3")
        restored = self.restore_file("state.json")
        manifest = self.manifest()
        broken = b"{not json"
        restored.write_bytes(broken)
        for item in manifest["files"]:
            if item["name"] == "state.json":
                item["sha256"] = hashlib.sha256(broken).hexdigest()
        self.write_manifest(manifest)
        with self.assertRaises(OpsError):
            verify_restored_package(self.output / "manifest.json", self.restore)

    def test_unsafe_manifest_names_and_invalid_manifest_are_rejected(self):
        database, writer = self.database()
        try:
            create_snapshot_package([database], self.output)
        finally:
            writer.close()
        self.restore_file("archive.sqlite3")
        manifest = self.manifest()
        manifest["files"][0]["name"] = "../escape.sqlite3"
        self.write_manifest(manifest)
        with self.assertRaises(OpsError):
            verify_restored_package(self.output / "manifest.json", self.restore)
        self.write_manifest({"format": "wrong", "files": []})
        with self.assertRaises(OpsError):
            verify_restored_package(self.output / "manifest.json", self.restore)
        (self.output / "manifest.json").write_text("{")
        with self.assertRaises(OpsError):
            verify_restored_package(self.output / "manifest.json", self.restore)

    def test_restored_symlink_is_rejected(self):
        database, writer = self.database()
        try:
            create_snapshot_package([database], self.output)
        finally:
            writer.close()
        outside = self.root / "outside.sqlite3"
        with gzip.open(self.output / "archive.sqlite3.gz", "rb") as source:
            outside.write_bytes(source.read())
        self.restore.mkdir()
        (self.restore / "archive.sqlite3").symlink_to(outside)
        with self.assertRaises(OpsError):
            verify_restored_package(self.output / "manifest.json", self.restore)


class HealthMonitorTests(unittest.TestCase):
    NOW = 1_800_000_000.0

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        (self.root / "data").mkdir()
        self.state_path = self.root / "private" / "health.json"
        self.messages = []
        self.active = {
            unit: {"LoadState": "loaded", "ActiveState": "active", "SubState": "running", "Result": "success"}
            for unit in SERVICE_UNITS
        }
        self.write_status(
            "archive-pipeline-status.json",
            {"state": "running", "heartbeatAt": self.iso(self.NOW - 10), "updatedAt": self.iso(self.NOW - 10), "lastError": ""},
        )
        self.write_status(
            "catalog-publish-status.json",
            {"state": "verified", "updatedAt": self.iso(self.NOW - 7200), "lastError": ""},
        )

    def tearDown(self):
        self.folder.cleanup()

    def iso(self, value):
        import datetime

        return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).isoformat()

    def write_status(self, name, payload):
        (self.root / "data" / name).write_text(json.dumps(payload))

    def run_check(self, *, probe=None, disk=None, http=None):
        return run_health_check(
            root=self.root,
            state_path=self.state_path,
            notifier=self.messages.append,
            service_probe=probe or (lambda unit: self.active[unit]),
            disk_usage=disk or (lambda path: SimpleNamespace(total=1000, free=500)),
            http_get=http or (lambda url: 200),
            disk_path=self.root,
            min_free_percent=10.0,
            homepage_url="https://example.test/",
            now=self.NOW,
        )

    def test_exact_service_set_and_healthy_report_is_quiet(self):
        self.assertEqual(
            SERVICE_UNITS,
            (
                "animeverse-archive-pipeline.service",
                "animeverse-catalog-publisher.service",
                "animeverse-download-cache.service",
                "animeverse-download-cache-tunnel.service",
                "animeverse-admin.service",
                "animeverse-admin-tunnel.service",
            ),
        )
        result = self.run_check()
        self.assertTrue(result["ok"])
        self.assertEqual(result["notifications"], [])
        self.assertEqual(len(result["checks"]), 8)
        self.assertEqual(stat.S_IMODE(self.state_path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.state_path.parent.stat().st_mode), 0o700)
        self.assertEqual(json.loads(self.state_path.read_text())["active"], {})

    def test_failed_notification_is_retained_and_retried(self):
        self.active[SERVICE_UNITS[0]]['ActiveState'] = 'failed'
        def failing(_message):
            raise RuntimeError('simulated notifier outage')
        arguments = dict(root=self.root, state_path=self.state_path,
            service_probe=lambda unit: self.active[unit], disk_usage=lambda path: SimpleNamespace(total=1000, free=500),
            http_get=lambda url: 200, disk_path=self.root, now=self.NOW)
        with self.assertRaises(RuntimeError):
            run_health_check(**arguments, notifier=failing)
        self.assertEqual(len(json.loads(self.state_path.read_text())['pending']), 1)
        run_health_check(**arguments, notifier=self.messages.append)
        self.assertEqual(len(self.messages), 1)
        self.assertEqual(json.loads(self.state_path.read_text())['pending'], [])

    def test_failure_is_deduplicated_and_recovery_is_notified_once(self):
        def failing(unit):
            if unit == "animeverse-admin.service":
                return {**self.active[unit], "ActiveState": "failed", "SubState": "failed"}
            return self.active[unit]

        self.write_status(
            "archive-pipeline-status.json",
            {
                "state": "running",
                "heartbeatAt": self.iso(self.NOW - 10),
                "updatedAt": self.iso(self.NOW - 10),
                "lastError": "Authorization: Bearer top-secret; password=hunter2; ghp_abcdefghijklmnopqrstuvwxyz123456",
            },
        )
        result = self.run_check(probe=failing)
        self.assertFalse(result["ok"])
        self.assertEqual(len(self.messages), 1)
        self.assertIn("AnimeVerse health failure", self.messages[0])
        self.assertIn("service:animeverse-admin.service", self.messages[0])
        self.assertIn("service:animeverse-archive-pipeline.service", self.messages[0])
        self.assertNotIn("top-secret", self.messages[0])
        self.assertNotIn("hunter2", self.messages[0])
        self.assertNotIn("ghp_", self.messages[0])
        self.assertNotIn("top-secret", self.state_path.read_text())
        self.assertNotIn("ghp_", self.state_path.read_text())
        self.assertEqual(len(json.loads(self.state_path.read_text())["active"]), 2)

        repeated = self.run_check(probe=failing)
        self.assertFalse(repeated["ok"])
        self.assertEqual(len(self.messages), 1)

        self.write_status(
            "archive-pipeline-status.json",
            {"state": "running", "heartbeatAt": self.iso(self.NOW - 10), "updatedAt": self.iso(self.NOW - 10), "lastError": ""},
        )
        recovered = self.run_check()
        self.assertTrue(recovered["ok"])
        self.assertEqual(len(self.messages), 2)
        self.assertIn("AnimeVerse health recovered", self.messages[1])
        self.assertEqual(json.loads(self.state_path.read_text())["active"], {})

    def test_expected_telegram_wait_does_not_fail_freshness(self):
        self.write_status(
            "archive-pipeline-status.json",
            {
                "state": "running",
                "heartbeatAt": self.iso(self.NOW - 3600),
                "updatedAt": self.iso(self.NOW - 3600),
                "floodWaitUntil": self.NOW + 600,
                "lastError": "",
            },
        )
        result = self.run_check()
        self.assertTrue(result["ok"])
        self.assertEqual(self.messages, [])
        archive = next(item for item in result["checks"] if "archive-pipeline" in item["key"])
        self.assertIn("Telegram wait", archive["detail"])

    def test_stale_archive_heartbeat_and_catalog_error_fail(self):
        self.write_status(
            "archive-pipeline-status.json",
            {"state": "running", "heartbeatAt": self.iso(self.NOW - 3600), "updatedAt": self.iso(self.NOW - 3600), "lastError": ""},
        )
        self.write_status(
            "catalog-publish-status.json",
            {"state": "error", "updatedAt": self.iso(self.NOW), "lastError": "publish failed"},
        )
        result = self.run_check()
        failing = {item["key"] for item in result["checks"] if not item["ok"]}
        self.assertIn("service:animeverse-archive-pipeline.service", failing)
        self.assertIn("service:animeverse-catalog-publisher.service", failing)

    def test_busy_catalog_freshness_is_checked(self):
        self.write_status(
            "catalog-publish-status.json",
            {"state": "building", "updatedAt": self.iso(self.NOW - 4000), "lastError": ""},
        )
        result = self.run_check()
        self.assertFalse(result["ok"])
        self.assertIn("heartbeat", self.messages[0])

    def test_disk_threshold_and_recovery(self):
        result = self.run_check(disk=lambda path: SimpleNamespace(total=1000, free=50))
        self.assertFalse(result["ok"])
        self.assertEqual(self.messages[0].count("- disk:"), 1)
        self.assertIn("5.0% free", self.messages[0])
        recovered = self.run_check()
        self.assertTrue(recovered["ok"])
        self.assertEqual(len(self.messages), 2)
        self.assertIn("recovered", self.messages[1])

    def test_remote_homepage_status_and_recovery(self):
        result = self.run_check(http=lambda url: 503)
        self.assertFalse(result["ok"])
        self.assertIn("homepage HTTP 503", self.messages[0])
        recovered = self.run_check()
        self.assertTrue(recovered["ok"])
        self.assertEqual(len(self.messages), 2)

    def test_missing_status_and_probe_errors_do_not_leak_details(self):
        (self.root / "data" / "archive-pipeline-status.json").unlink()

        def broken(unit):
            if unit == "animeverse-admin-tunnel.service":
                raise RuntimeError("token=super-secret")
            return self.active[unit]

        result = self.run_check(probe=broken)
        failing = {item["key"] for item in result["checks"] if not item["ok"]}
        self.assertIn("service:animeverse-archive-pipeline.service", failing)
        self.assertIn("service:animeverse-admin-tunnel.service", failing)
        self.assertNotIn("super-secret", json.dumps(result))
        self.assertNotIn("super-secret", self.state_path.read_text())

    def test_catalog_missing_status_is_tolerated_but_malformed_is_not(self):
        (self.root / "data" / "catalog-publish-status.json").unlink()
        self.assertTrue(self.run_check()["ok"])
        (self.root / "data" / "catalog-publish-status.json").write_text("{")
        result = self.run_check()
        self.assertFalse(result["ok"])
        self.assertIn("service:animeverse-catalog-publisher.service", self.messages[0])

    def test_invalid_homepage_configuration_is_rejected(self):
        with self.assertRaises(OpsError):
            collect_health_checks(
                root=self.root,
                now=self.NOW,
                service_probe=lambda unit: self.active[unit],
                disk_usage=lambda path: SimpleNamespace(total=1000, free=500),
                http_get=lambda url: 200,
                disk_path=self.root,
                homepage_url="https://user:secret@example.test/",
            )


if __name__ == "__main__":
    unittest.main()
