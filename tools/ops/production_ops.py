#!/usr/bin/env python3
"""Read-only production helpers for AnimeVerse.

Two focused operations live here:

* Package explicitly requested SQLite databases (and optional JSON state
  files) into a private directory with a hash manifest. SQLite files are
  copied through SQLite's online backup API, so WAL contents are included in
  a consistent snapshot. Off-host upload is intentionally out of scope.
* Inspect the six production services, heartbeat files, free disk space and
  the public homepage. Failures are deduplicated in a private JSON state file
  and sent through an injected notifier only. Nothing here restarts services,
  reads credentials or performs network mutations.

Both helpers use only the Python standard library.
"""
from __future__ import annotations

import argparse
from collections.abc import Callable, Mapping, Sequence
from contextlib import closing
import datetime as dt
import gzip
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from typing import Any
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
BACKUP_FORMAT = "animeverse-backup/v1"
MANIFEST_NAME = "manifest.json"
MAX_MANIFEST_BYTES = 1_000_000
MAX_STATUS_BYTES = 2_000_000
DEFAULT_HOMEPAGE = "https://animeverse-xi.vercel.app/"

SERVICE_UNITS = (
    "animeverse-archive-pipeline.service",
    "animeverse-catalog-publisher.service",
    "animeverse-download-cache.service",
    "animeverse-download-cache-tunnel.service",
    "animeverse-admin.service",
    "animeverse-admin-tunnel.service",
)

# Only services that write a status document have a freshness check. The
# catalog publisher is idle between verified publications, so its age is
# checked only while a publication is in progress.
HEARTBEATS = {
    SERVICE_UNITS[0]: {
        "path": "data/archive-pipeline-status.json",
        "max_age": 120.0,
        "required": True,
        "busy_states": None,
    },
    SERVICE_UNITS[1]: {
        "path": "data/catalog-publish-status.json",
        "max_age": 2700.0,
        "required": False,
        "busy_states": frozenset({"snapshot", "building", "publishing"}),
    },
}

_SECRET_PATTERNS = (
    re.compile(r"(?i)\b(token|secret|password|passwd|api[_-]?key|authorization)\b\s*[:=]\s*(?:bearer\s+)?\S+"),
    re.compile(r"(?i)\b(bearer)\s+[^\s,;]+"),
    re.compile(r"(?i)(https?://)[^/\s:@]+:[^/\s@]+@"),
    re.compile(r"(?i)(/bot)[0-9]+:[A-Za-z0-9_-]+"),
    re.compile(r"(?i)\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b"),
)


class OpsError(RuntimeError):
    """A safe, user-facing operational error."""


def _utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _iso(timestamp: float) -> str:
    return dt.datetime.fromtimestamp(float(timestamp), dt.timezone.utc).isoformat()


def _safe_text(value: Any, limit: int = 240) -> str:
    """Keep diagnostics useful without echoing credentials or control bytes."""
    text = " ".join(str(value or "").split())
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(lambda match: _redact(match), text)
    return text[:limit]


def _redact(match: re.Match[str]) -> str:
    value = match.group(0)
    if value.lower().startswith("bearer "):
        return "Bearer [redacted]"
    if "://" in value:
        scheme, rest = value.split("://", 1)
        return scheme + "://[redacted]@" + rest.split("@", 1)[-1]
    if value.lower().startswith("/bot"):
        return "/bot[redacted]"
    if ":" not in value and "=" not in value:
        return "[redacted]"
    name = value.split(":", 1)[0].split("=", 1)[0]
    return name + "=[redacted]"


def _file_digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _requested_file(value: str | Path, *, label: str) -> Path:
    path = Path(value)
    try:
        resolved = path.resolve(strict=True)
    except OSError:
        raise OpsError(f"{label} does not exist") from None
    if not resolved.is_file():
        raise OpsError(f"{label} is not a regular file")
    return resolved


def _safe_name(value: Any) -> str:
    if not isinstance(value, str) or not value or value in {".", ".."}:
        raise OpsError("manifest contains an invalid file name")
    if len(value) > 255 or any(ord(character) < 32 for character in value):
        raise OpsError("manifest contains an unsafe file name")
    if Path(value).name != value or "/" in value or "\\" in value or "\x00" in value:
        raise OpsError("manifest contains an unsafe file name")
    return value


def _quick_check(path: Path) -> None:
    try:
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=10)) as database:
            rows = database.execute("PRAGMA quick_check").fetchall()
    except sqlite3.Error as exc:
        raise OpsError(f"SQLite quick_check failed for {path.name} ({type(exc).__name__})") from None
    if len(rows) != 1 or rows[0][0] != "ok":
        raise OpsError(f"SQLite quick_check reported errors in {path.name}")


def _snapshot_sqlite(source: Path, destination: Path) -> None:
    try:
        with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=30)) as original:
            original.execute("PRAGMA query_only=ON")
            with closing(sqlite3.connect(destination)) as snapshot:
                original.backup(snapshot)
                snapshot.commit()
                rows = snapshot.execute("PRAGMA quick_check").fetchall()
                if len(rows) != 1 or rows[0][0] != "ok":
                    raise OpsError(f"SQLite quick_check reported errors in {source.name}")
    except sqlite3.Error as exc:
        raise OpsError(f"SQLite snapshot failed for {source.name} ({type(exc).__name__})") from None


def _compress(source: Path, destination: Path) -> None:
    with source.open("rb") as stream, gzip.open(destination, "wb", compresslevel=6) as output:
        shutil.copyfileobj(stream, output, length=1024 * 1024)
    os.chmod(destination, 0o600)


def _verify_gzip(destination: Path, expected_digest: str) -> None:
    try:
        with gzip.open(destination, "rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
    except (OSError, EOFError) as exc:
        raise OpsError(f"packaged file is not readable gzip ({type(exc).__name__})") from None
    if not hmac.compare_digest(digest, expected_digest):
        raise OpsError("packaged file does not match its snapshot hash")


def _parse_json_file(path: Path) -> None:
    try:
        with path.open("r", encoding="utf-8") as stream:
            json.load(stream)
    except (OSError, UnicodeDecodeError, ValueError, RecursionError):
        raise OpsError(f"JSON file {path.name} is invalid") from None


def _entry(source: Path, name: str, staging: Path, *, kind: str) -> dict[str, Any]:
    destination = staging / (name + ".gz")
    if destination.exists():
        raise OpsError(f"duplicate backup name: {name}")
    digest = _file_digest(source)
    _compress(source, destination)
    archive_digest = _file_digest(destination)
    _verify_gzip(destination, digest)
    return {
        "name": name,
        "archive": destination.name,
        "sha256": digest,
        "archive_sha256": archive_digest,
        "bytes": source.stat().st_size,
        "archive_bytes": destination.stat().st_size,
        "kind": kind,
    }


def create_snapshot_package(
    databases: Sequence[str | Path],
    output_dir: str | Path,
    json_files: Sequence[str | Path] = (),
) -> dict[str, Any]:
    """Create a new private package from explicit file paths only."""
    if isinstance(databases, (str, Path)):
        databases = [databases]
    if isinstance(json_files, (str, Path)):
        json_files = [json_files]
    database_sources = [_requested_file(value, label="database") for value in databases]
    json_sources = [_requested_file(value, label="JSON file") for value in json_files]
    if not database_sources:
        raise OpsError("at least one database is required")
    names = [path.name for path in (*database_sources, *json_sources)]
    if len(names) != len(set(names)):
        raise OpsError("backup file names must be unique")
    for path in json_sources:
        _parse_json_file(path)

    output = Path(output_dir)
    if output.exists():
        raise OpsError("output directory already exists")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=output.name + ".tmp-", dir=str(output.parent)))
    try:
        os.chmod(staging, 0o700)
        entries: list[dict[str, Any]] = []
        for source in database_sources:
            descriptor, temporary = tempfile.mkstemp(prefix=".snapshot-", dir=staging)
            os.close(descriptor)
            snapshot = Path(temporary)
            try:
                _snapshot_sqlite(source, snapshot)
                entries.append(_entry(snapshot, source.name, staging, kind="sqlite"))
            finally:
                snapshot.unlink(missing_ok=True)
        for source in json_sources:
            entries.append(_entry(source, source.name, staging, kind="json"))

        manifest = {
            "format": BACKUP_FORMAT,
            "createdAt": _utc_now(),
            "files": sorted(entries, key=lambda item: item["name"]),
        }
        manifest_path = staging / MANIFEST_NAME
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.chmod(manifest_path, 0o600)
        if output.exists():
            raise OpsError("output directory already exists")
        staging.rename(output)
        return manifest
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def _load_manifest(path: str | Path) -> dict[str, Any]:
    if Path(path).is_symlink():
        raise OpsError("manifest is not an acceptable regular file")
    manifest_path = _requested_file(path, label="manifest")
    if manifest_path.stat().st_size > MAX_MANIFEST_BYTES:
        raise OpsError("manifest is not an acceptable regular file")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError, RecursionError):
        raise OpsError("manifest is not valid JSON") from None
    if not isinstance(manifest, dict) or manifest.get("format") != BACKUP_FORMAT:
        raise OpsError("manifest format is not supported")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise OpsError("manifest has no files")
    return manifest


def verify_restored_package(manifest_path: str | Path, restore_dir: str | Path) -> dict[str, Any]:
    """Verify restored databases (hash + quick_check) and JSON state files."""
    manifest = _load_manifest(manifest_path)
    restore = Path(restore_dir)
    if restore.is_symlink():
        raise OpsError("restore directory is not a regular directory")
    try:
        restore = restore.resolve(strict=True)
    except OSError:
        raise OpsError("restore directory does not exist") from None
    if not restore.is_dir():
        raise OpsError("restore directory is not a regular directory")

    counts = {"sqlite": 0, "json": 0}
    seen: set[str] = set()
    for entry in manifest["files"]:
        if not isinstance(entry, dict):
            raise OpsError("manifest contains an invalid entry")
        name = _safe_name(entry.get("name"))
        if name in seen:
            raise OpsError(f"manifest contains duplicate file name: {name}")
        seen.add(name)
        expected = entry.get("sha256")
        if not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected):
            raise OpsError(f"manifest has an invalid hash for {name}")
        kind = entry.get("kind")
        if kind not in counts:
            raise OpsError(f"manifest has an unsupported kind for {name}")
        restored = restore / name
        if restored.is_symlink():
            raise OpsError(f"restored file is a symlink: {name}")
        try:
            restored = restored.resolve(strict=True)
        except OSError:
            raise OpsError(f"restored file is missing: {name}") from None
        if restored.parent != restore or not restored.is_file():
            raise OpsError(f"restored file is outside the restore directory: {name}")
        if not hmac.compare_digest(_file_digest(restored), expected):
            raise OpsError(f"restored file hash mismatch: {name}")
        if kind == "sqlite":
            _quick_check(restored)
        else:
            _parse_json_file(restored)
        counts[kind] += 1
    return {"ok": True, "restoreDir": str(restore), "files": counts}


def _read_status(path: Path) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise OpsError("status file is missing")
    if path.stat().st_size > MAX_STATUS_BYTES:
        raise OpsError("status file is unexpectedly large")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError, RecursionError):
        raise OpsError("status file is not valid JSON") from None
    if not isinstance(payload, dict):
        raise OpsError("status file is not a JSON object")
    return payload


def _parse_timestamp(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.timestamp()


def _wait_until(payload: Mapping[str, Any]) -> float | None:
    value = payload.get("floodWaitUntil")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _heartbeat_check(unit: str, root: Path, now: float) -> tuple[bool, str]:
    spec = HEARTBEATS[unit]
    path = root / spec["path"]
    if path.is_symlink():
        return False, "status file is a symlink"
    if not path.exists():
        if spec["required"]:
            return False, "status file is missing"
        return True, "no heartbeat yet"
    try:
        payload = _read_status(path)
    except OpsError as exc:
        return False, str(exc)

    wait_until = _wait_until(payload)
    if wait_until is not None and wait_until > now:
        try:
            return True, f"expected Telegram wait until {_iso(wait_until)}"
        except (OSError, OverflowError, ValueError):
            return False, "Telegram wait timestamp is invalid"

    error = _safe_text(payload.get("lastError"))
    if error:
        return False, f"lastError: {error}"
    state = str(payload.get("state") or "").lower()
    if state == "error":
        return False, "status reports error"

    busy_states = spec["busy_states"]
    if busy_states is not None and state not in busy_states:
        return True, "idle or verified"

    stamp = _parse_timestamp(payload.get("heartbeatAt") or payload.get("updatedAt"))
    if stamp is None:
        return False, "heartbeat timestamp is missing"
    age = now - stamp
    if age < 0:
        age = 0.0
    if age > float(spec["max_age"]):
        return False, f"heartbeat is {int(age)}s old"
    return True, f"heartbeat is {int(age)}s old"


def _service_check(unit: str, root: Path, now: float, probe: Callable[[str], Mapping[str, Any]]) -> dict[str, Any]:
    try:
        info = probe(unit)
    except Exception as exc:
        return {"key": f"service:{unit}", "ok": False, "detail": f"systemd probe failed ({type(exc).__name__})"}
    if not isinstance(info, Mapping):
        return {"key": f"service:{unit}", "ok": False, "detail": "systemd probe returned no data"}
    load_state = str(info.get("LoadState") or info.get("load_state") or "").lower()
    active_state = str(info.get("ActiveState") or info.get("active_state") or "").lower()
    sub_state = str(info.get("SubState") or info.get("sub_state") or "").lower()
    result = str(info.get("Result") or info.get("result") or "").lower()
    if load_state and load_state != "loaded":
        return {"key": f"service:{unit}", "ok": False, "detail": f"systemd load state {load_state}"}
    if active_state != "active":
        return {
            "key": f"service:{unit}",
            "ok": False,
            "detail": f"systemd state {active_state or 'unknown'}/{sub_state or 'unknown'}",
        }
    if result not in {"", "success"}:
        return {"key": f"service:{unit}", "ok": False, "detail": f"systemd result {result}"}
    if unit in HEARTBEATS:
        ok, detail = _heartbeat_check(unit, root, now)
        return {"key": f"service:{unit}", "ok": ok, "detail": detail}
    return {"key": f"service:{unit}", "ok": True, "detail": "active"}


def _disk_check(
    path: str | Path,
    min_free_percent: float,
    disk_usage: Callable[[Any], Any],
) -> dict[str, Any]:
    try:
        usage = disk_usage(path)
    except Exception as exc:
        return {"key": "disk", "ok": False, "detail": f"disk usage unavailable ({type(exc).__name__})"}
    if isinstance(usage, Mapping):
        total, free = usage.get("total"), usage.get("free")
    else:
        total, free = getattr(usage, "total", None), getattr(usage, "free", None)
    if not isinstance(total, (int, float)) or not isinstance(free, (int, float)) or total <= 0:
        return {"key": "disk", "ok": False, "detail": "disk usage is invalid"}
    percent = max(0.0, float(free) * 100.0 / float(total))
    detail = f"{percent:.1f}% free at {path}"
    return {"key": "disk", "ok": percent >= min_free_percent, "detail": detail}


def _homepage_check(url: str, http_get: Callable[[str], Any]) -> dict[str, Any]:
    try:
        parsed = urllib.parse.urlsplit(url)
        scheme, hostname = parsed.scheme, parsed.hostname
        username, password = parsed.username, parsed.password
    except ValueError:
        raise OpsError("homepage URL is invalid") from None
    if scheme not in {"http", "https"} or not hostname or username or password:
        raise OpsError("homepage URL must be http(s) without credentials")
    try:
        status = int(http_get(url))
    except Exception as exc:
        return {"key": "homepage", "ok": False, "detail": f"homepage request failed ({type(exc).__name__})"}
    return {"key": "homepage", "ok": status == 200, "detail": f"homepage HTTP {status}"}


def collect_health_checks(
    *,
    root: str | Path,
    now: float,
    service_probe: Callable[[str], Mapping[str, Any]],
    disk_usage: Callable[[Any], Any],
    http_get: Callable[[str], Any],
    disk_path: str | Path,
    min_free_percent: float = 10.0,
    homepage_url: str = DEFAULT_HOMEPAGE,
) -> list[dict[str, Any]]:
    if not 0 <= min_free_percent <= 100:
        raise OpsError("minimum free disk percentage must be between 0 and 100")
    root_path = Path(root)
    checks = [_service_check(unit, root_path, float(now), service_probe) for unit in SERVICE_UNITS]
    checks.append(_disk_check(disk_path, float(min_free_percent), disk_usage))
    checks.append(_homepage_check(homepage_url, http_get))
    return checks


def _load_health_state(path: str | Path) -> dict[str, Any]:
    state_path = Path(path)
    if state_path.is_symlink():
        return {"version": 1, "active": {}}
    try:
        if state_path.stat().st_size > MAX_STATUS_BYTES:
            return {"version": 1, "active": {}}
        payload = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError, RecursionError):
        return {"version": 1, "active": {}}
    if not isinstance(payload, dict) or not isinstance(payload.get("active"), dict):
        return {"version": 1, "active": {}}
    active: dict[str, dict[str, str]] = {}
    for key, value in payload["active"].items():
        if not isinstance(key, str) or not isinstance(value, dict):
            continue
        active[_safe_text(key, 200)] = {
            "detail": _safe_text(value.get("detail")),
            "since": _safe_text(value.get("since"), 80),
        }
    pending = [_safe_text(item, 4000) for item in payload.get('pending', []) if isinstance(item, str)]
    return {"version": 1, "active": active, "pending": pending[:100]}


def _write_private_json(path: str | Path, payload: Any) -> None:
    state_path = Path(path)
    state_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=state_path.name + ".", dir=str(state_path.parent))
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, indent=2, sort_keys=True, ensure_ascii=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, state_path)
        os.chmod(state_path, 0o600)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def _transition(
    state: Mapping[str, Any], checks: Sequence[Mapping[str, Any]], now: float
) -> tuple[dict[str, Any], list[str]]:
    previous = state.get("active") if isinstance(state.get("active"), dict) else {}
    current: dict[str, dict[str, str]] = {}
    failures: list[dict[str, str]] = []
    recoveries: list[dict[str, str]] = []
    stamp = _iso(now)
    for check in checks:
        key = _safe_text(check.get("key"), 200)
        detail = _safe_text(check.get("detail"))
        if not key:
            continue
        if check.get("ok"):
            if key in previous:
                recoveries.append({"key": key, "detail": _safe_text(previous[key].get("detail"))})
            continue
        if key in previous:
            current[key] = {
                "detail": detail,
                "since": _safe_text(previous[key].get("since"), 80) or stamp,
            }
        else:
            current[key] = {"detail": detail, "since": stamp}
            failures.append({"key": key, "detail": detail})
    messages = []
    if failures:
        messages.append(_notification("AnimeVerse health failure", failures))
    if recoveries:
        messages.append(_notification("AnimeVerse health recovered", recoveries))
    return {"version": 1, "updatedAt": stamp, "active": current}, messages


def _notification(title: str, items: Sequence[Mapping[str, str]]) -> str:
    lines = [title]
    lines.extend(f"- {item['key']}: {item['detail']}" for item in items)
    return "\n".join(lines)


def run_health_check(
    *,
    root: str | Path,
    state_path: str | Path,
    notifier: Callable[[str], Any],
    service_probe: Callable[[str], Mapping[str, Any]],
    disk_usage: Callable[[Any], Any],
    http_get: Callable[[str], Any],
    disk_path: str | Path,
    min_free_percent: float = 10.0,
    homepage_url: str = DEFAULT_HOMEPAGE,
    now: float | None = None,
    extra_checks: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    """Collect checks, persist deduplicated state, then call the notifier."""
    instant = time.time() if now is None else float(now)
    checks = collect_health_checks(
        root=root,
        now=instant,
        service_probe=service_probe,
        disk_usage=disk_usage,
        http_get=http_get,
        disk_path=disk_path,
        min_free_percent=min_free_percent,
        homepage_url=homepage_url,
    )
    checks.extend(dict(check) for check in extra_checks)
    previous = _load_health_state(state_path)
    state, messages = _transition(previous, checks, instant)
    # Durable outbox: a failed notification must be retried, not silently lost.
    # A crash after Telegram accepts a message can cause one duplicate.
    state['pending'] = list(previous.get('pending', [])) + messages
    _write_private_json(state_path, state)
    for message in list(state['pending']):
        if notifier(message) is False:
            raise OpsError('Notification delivery failed; retained for retry')
        state['pending'].pop(0)
        _write_private_json(state_path, state)
    return {
        "ok": all(check["ok"] for check in checks),
        "checks": checks,
        "notifications": messages,
        "statePath": str(state_path),
    }


def _systemd_probe(unit: str) -> dict[str, str]:
    command = [
        "systemctl",
        "show",
        unit,
        "--no-pager",
        "--property=LoadState",
        "--property=ActiveState",
        "--property=SubState",
        "--property=Result",
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=8, check=False)
    if result.returncode != 0:
        raise RuntimeError("systemctl show failed")
    values = {}
    for line in result.stdout.splitlines():
        key, separator, value = line.partition("=")
        if separator:
            values[key] = value
    return values


def _http_status(url: str) -> int:
    request = urllib.request.Request(url, headers={"User-Agent": "AnimeVerseHealth/1"}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            response.read(1024)
            return int(response.status)
    except urllib.error.HTTPError as exc:
        return int(exc.code)


def _default_state_path() -> Path:
    return Path.home() / ".local" / "state" / "animeverse-health" / "state.json"


def _add_health_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--root", default=str(ROOT))
    parser.add_argument("--disk-path", default=str(ROOT))
    parser.add_argument("--min-free-percent", type=float, default=10.0)
    parser.add_argument("--homepage", default=DEFAULT_HOMEPAGE)


def _health_command(args: argparse.Namespace) -> int:
    checks = collect_health_checks(
        root=args.root,
        now=time.time(),
        service_probe=_systemd_probe,
        disk_usage=shutil.disk_usage,
        http_get=_http_status,
        disk_path=args.disk_path,
        min_free_percent=args.min_free_percent,
        homepage_url=args.homepage,
    )
    print(json.dumps({"ok": all(check["ok"] for check in checks), "checks": checks}, indent=2))
    return 0 if all(check["ok"] for check in checks) else 1


def _monitor_command(args: argparse.Namespace) -> int:
    messages: list[str] = []
    result = run_health_check(
        root=args.root,
        state_path=args.state,
        notifier=messages.append,
        service_probe=_systemd_probe,
        disk_usage=shutil.disk_usage,
        http_get=_http_status,
        disk_path=args.disk_path,
        min_free_percent=args.min_free_percent,
        homepage_url=args.homepage,
    )
    print(json.dumps(result, indent=2))
    return 0 if result["ok"] else 1


def _backup_command(args: argparse.Namespace) -> int:
    manifest = create_snapshot_package(args.database, args.output, args.json)
    print(json.dumps({"ok": True, "output": args.output, "files": len(manifest["files"])}, indent=2))
    return 0


def _verify_command(args: argparse.Namespace) -> int:
    report = verify_restored_package(args.manifest, args.restore_dir)
    print(json.dumps(report, indent=2))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AnimeVerse read-only production operations")
    commands = parser.add_subparsers(dest="command", required=True)

    backup = commands.add_parser("backup", help="package explicit SQLite/JSON files")
    backup.add_argument("--database", action="append", required=True, help="explicit SQLite database path")
    backup.add_argument("--json", action="append", default=[], help="optional explicit JSON state file")
    backup.add_argument("--output", required=True, help="new private output directory")
    backup.set_defaults(handler=_backup_command)

    verify = commands.add_parser("verify", help="verify a restored package")
    verify.add_argument("--manifest", required=True)
    verify.add_argument("--restore-dir", required=True)
    verify.set_defaults(handler=_verify_command)

    health = commands.add_parser("health", help="print a read-only health report")
    _add_health_options(health)
    health.set_defaults(handler=_health_command)

    monitor = commands.add_parser("monitor", help="stateful health check with local deduplication")
    _add_health_options(monitor)
    monitor.add_argument("--state", default=str(_default_state_path()), help="private deduplication state file")
    monitor.set_defaults(handler=_monitor_command)

    args = parser.parse_args(argv)
    try:
        return args.handler(args)
    except OpsError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except OSError:
        print("error: filesystem operation failed", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
