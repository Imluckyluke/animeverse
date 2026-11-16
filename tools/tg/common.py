"""Shared config, state, status and small helpers for the AniPlus sync worker."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import random
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
PUBLIC_COVERS = ROOT / "public" / "covers" / "aniplus"
LOGS = ROOT / "logs"

DATA.mkdir(exist_ok=True)
PUBLIC_COVERS.mkdir(parents=True, exist_ok=True)
LOGS.mkdir(exist_ok=True)

SESSION_FILE = Path(__file__).with_name("session.txt")
STATE_PATH = DATA / "aniplus-state.json"
STATUS_PATH = DATA / "sync-status.json"
# MiniBot has its own anti-spam window. Keep it separately from the generic
# status file so an unrelated account FloodWait cannot erase it on restart.
MINIBOT_WAIT_PATH = DATA / "minibot-wait.json"
STOP_PATH = DATA / "sync.stop"
LOCK_PATH = DATA / "sync.lock"
LINKS_PATH = DATA / "aniplus-links.json"
REQUESTS_PATH = DATA / "link-requests.jsonl"
SYNC_LOG = DATA / "sync.log"
CATALOG_PATH = ROOT / "src" / "lib" / "real-catalog.json"

SOURCE_CHANNEL = "aniplus"
DEST_CHANNEL = "testanivers"
DEST_USERNAME = "testanivers"

# Private archive that already contains the same releases with clean filenames.
# The invite hash is not a secret in the usual sense, but it is kept in the
# environment so the worker can be moved to another archive without code edits.
ARCHIVE_INVITE = os.environ.get('AV_ARCHIVE_INVITE', '').strip()
ARCHIVE_TITLE = os.environ.get("AV_ARCHIVE_TITLE", "انیمه سکای").strip()
ARCHIVE_SEARCH_LIMIT = max(10, int(os.environ.get("AV_ARCHIVE_SEARCH_LIMIT", "30")))
ARCHIVE_COPY_DELAY = float(os.environ.get("AV_ARCHIVE_COPY_DELAY", "4"))
ARCHIVE_SEARCH_DELAY = float(os.environ.get("AV_ARCHIVE_SEARCH_DELAY", "1.5"))

API_ID = int(os.environ.get("TG_API_ID") or "2040")
API_HASH = os.environ.get("TG_API_HASH") or "b18441a1ff607e10a989891a5462e627"

# MiniBot is much more sensitive than a normal user account. Keep generous
# spacing and take a longer break before the next link. Archive hits bypass
# MiniBot entirely, which is the main protection against account-wide floods.
LINK_DELAY = float(os.environ.get("AV_LINK_DELAY", "60"))
LINK_JITTER = float(os.environ.get("AV_LINK_JITTER", "15"))
LINK_COOLDOWN = int(os.environ.get("AV_LINK_COOLDOWN", "300"))
LINK_COOLDOWN_EVERY = int(os.environ.get("AV_LINK_COOLDOWN_EVERY", "10"))
WATCH_INTERVAL = int(os.environ.get("AV_WATCH_INTERVAL", "300"))
MAX_ATTEMPTS = int(os.environ.get("AV_MAX_ATTEMPTS", "3"))
# 0 means "obey Telegram's requested wait exactly". A non-zero value remains
# available for tests, but production intentionally never retries early.
MAX_FLOOD_WAIT = max(0, int(os.environ.get("AV_MAX_FLOOD_WAIT", "0")))
FLOOD_COOLDOWN = max(0, int(os.environ.get("AV_FLOOD_COOLDOWN", "180")))
STEP_TIMEOUT = int(os.environ.get("AV_STEP_TIMEOUT", "50"))
DOC_TIMEOUT = int(os.environ.get("AV_DOC_TIMEOUT", "100"))

QUALITY_ORDER = [
    "1080p",
    "720p",
    "480p",
    "1080p x265",
    "720p x265",
    "480p x265",
    "4k",
    "2160p",
]

FA2EN = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
EN2FA = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def fa_digits(value: Any) -> str:
    return str(value).translate(EN2FA)


def norm_fa(value: str) -> str:
    """Normalise ZWNJ / Arabic chars for label matching."""
    return (
        (value or "")
        .replace("\u200c", " ")
        .replace("\u200f", "")
        .replace("\u200e", "")
        .replace("ي", "ی")
        .replace("ك", "ک")
    )


def atomic_write_json(path: Path, payload: Any, indent: int | None = 1) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=indent)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def read_json(path: Path, default: Any = None) -> Any:
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def read_session() -> str:
    value = os.environ.get("TG_SESSION", "").strip()
    if value:
        return value
    if SESSION_FILE.exists():
        return SESSION_FILE.read_text(encoding="utf-8").strip()
    raise SystemExit("Telegram session not found (tools/tg/session.txt or TG_SESSION)")


def pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False


def effective_flood_wait(requested: int) -> int:
    """Return how long to sleep for a Telegram FloodWait.

    Telegram's value is authoritative. The old 10-minute cap caused repeated
    early retries against an account-wide block, which only made the block
    longer. A configured cap is kept for diagnostics/tests, but the default is
    zero (no cap) so a flood is never hammered.
    """
    seconds = max(1, int(requested))
    if MAX_FLOOD_WAIT <= 0:
        return seconds
    return min(seconds, MAX_FLOOD_WAIT)


def quality_key(label: str) -> tuple[int, int, str]:
    low = label.lower().strip()
    base = 0
    if "2160" in low or "4k" in low:
        base = 2160
    elif "1080" in low:
        base = 1080
    elif "720" in low:
        base = 720
    elif "480" in low:
        base = 480
    try:
        idx = QUALITY_ORDER.index(low)
    except ValueError:
        idx = 100 + base
    return (1 if "x265" in low else 0, -base, str(idx))


def ordered_qualities(labels: list[str]) -> list[str]:
    seen: list[str] = []
    for item in labels:
        value = (item or "").strip().lower()
        if value and value not in seen:
            seen.append(value)
    return sorted(seen, key=quality_key)


def slugify(value: str) -> str:
    text = (value or "").strip().lower()
    text = text.replace("&", " and ").replace("+", " plus ")
    text = re.sub(r"['’`]", "", text)
    text = re.sub(r"[^a-z0-9\u0600-\u06FF]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    if not text:
        return ""
    # Pure Persian slugs are valid but awkward; keep them short.
    return text[:80].strip("-")


def short_hash(value: str) -> int:
    return int(hashlib.sha1(value.encode("utf-8")).hexdigest()[:10], 16)


def start_param(deep_link: str) -> str:
    m = re.search(r"[?&]start=([^&]+)", deep_link or "")
    return m.group(1) if m else ""


def sleep_sync(seconds: float) -> None:
    end = time.time() + max(0.0, seconds)
    while time.time() < end:
        if STOP_PATH.exists():
            raise Stopped()
        time.sleep(min(0.5, end - time.time()))


class Stopped(Exception):
    pass


def check_stop() -> None:
    if STOP_PATH.exists():
        raise Stopped()


def clear_stop() -> None:
    try:
        STOP_PATH.unlink()
    except FileNotFoundError:
        pass


def write_stop(job_id: str = "") -> None:
    atomic_write_json(STOP_PATH, {"jobId": job_id, "ts": now_iso()})


class Status:
    """Atomic progress file consumed by /api/admin/sync."""

    def __init__(self, job_id: str, posts_total: int = 0) -> None:
        self.job_id = job_id
        self.started = time.time()
        self.last_write = 0.0
        self.data: dict[str, Any] = {
            "jobId": job_id,
            "state": "running",
            "phase": "start",
            "pid": os.getpid(),
            "requestedPosts": posts_total,
            "scannedPosts": 0,
            "postsDone": 0,
            "postsTotal": posts_total,
            "animeNew": 0,
            "animeUpdated": 0,
            "catalogCount": 0,
            "coversDone": 0,
            "coversTotal": 0,
            "linksTotal": 0,
            "linksDone": 0,
            "linksFailed": 0,
            "linksPending": 0,
            "current": None,
            "currentSince": None,
            "lastError": "",
            "floodWaitUntil": None,
            "floodReason": "",
            "floodRequestedSec": 0,
            "avgSecPerLink": 0,
            "etaSec": None,
            "nextPollAt": None,
            "startedAt": now_iso(),
            "updatedAt": now_iso(),
            "heartbeatAt": now_iso(),
            "lastActivityAt": now_iso(),
            "log": [],
        }
        self.write(force=True)

    def update(self, **values: Any) -> None:
        current = values.get("current", "__missing__")
        if current != "__missing__":
            if current is None:
                self.data["current"] = None
                self.data["currentSince"] = None
            else:
                old = self.data.get("current") or {}
                if old.get("key") != current.get("key"):
                    self.data["currentSince"] = now_iso()
                self.data["current"] = current
        for key, value in values.items():
            if key == "current":
                continue
            self.data[key] = value
        self.data["lastActivityAt"] = now_iso()
        self.write()

    def phase(self, phase: str) -> None:
        self.update(phase=phase)

    def state(self, state: str) -> None:
        self.update(state=state)

    def log(self, message: str, level: str = "info") -> None:
        stamp = dt.datetime.now().strftime("%H:%M:%S")
        entry = {"ts": stamp, "level": level, "msg": str(message)[:500]}
        logs = self.data.get("log") or []
        logs.append(entry)
        self.data["log"] = logs[-70:]
        self.data["lastActivityAt"] = now_iso()
        if level == "error":
            self.data["lastError"] = str(message)[:500]
        try:
            with SYNC_LOG.open("a", encoding="utf-8") as fh:
                fh.write(f"{dt.datetime.now().isoformat()} [{level}] {message}\n")
        except OSError:
            pass
        print(f"[{stamp}] {message}", flush=True)
        self.write()

    def flood(self, seconds: int, reason: str, requested: int | None = None) -> None:
        requested_seconds = max(1, int(requested or seconds))
        effective = effective_flood_wait(seconds)
        until = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=effective)
        self.update(
            floodWaitUntil=until.isoformat(),
            floodReason=reason[:160],
            floodRequestedSec=requested_seconds,
        )
        minutes = max(1, (effective + 59) // 60)
        if requested_seconds > effective:
            requested_minutes = max(1, (requested_seconds + 59) // 60)
            self.log(
                f"⏳ محدودیت تلگرام ({reason}) — تلگرام {requested_minutes} دقیقه خواسته بود؛ "
                f"طبق تنظیم فعلی {minutes} دقیقه صبر می‌کنیم",
                "warn",
            )
        else:
            self.log(
                f"⏳ محدودیت تلگرام ({reason}) — {minutes} دقیقه صبر می‌کنیم؛ "
                "هیچ درخواستی قبل از پایان آن فرستاده نمی‌شود",
                "warn",
            )

    def clear_flood(self) -> None:
        self.update(floodWaitUntil=None, floodReason="", floodRequestedSec=0)

    def heartbeat(self) -> None:
        self.data["heartbeatAt"] = now_iso()
        self.data["updatedAt"] = now_iso()
        self.write(force=True)

    def write(self, force: bool = False) -> None:
        now = time.time()
        if not force and now - self.last_write < 0.7:
            return
        self.last_write = now
        self.data["updatedAt"] = now_iso()
        atomic_write_json(STATUS_PATH, self.data)

    def finish(self, state: str = "done", message: str = "") -> None:
        if message:
            self.log(message, "info" if state == "done" else "warn")
        self.data["state"] = state
        self.data["current"] = None
        self.data["currentSince"] = None
        self.data["nextPollAt"] = None
        # A manual stop does not mean Telegram's FloodWait has ended. Keep the
        # window so the next worker restores it instead of calling MiniBot early.
        if state == "done":
            self.data["floodWaitUntil"] = None
            self.data["floodReason"] = ""
            self.data["floodRequestedSec"] = 0
        self.data["heartbeatAt"] = now_iso()
        self.data["lastActivityAt"] = now_iso()
        self.write(force=True)


def new_state() -> dict[str, Any]:
    return {
        "version": 1,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
        "lastScanId": 0,
        "seen": {},
        "anime": {},
        "queue": {},
        "sponsors": {},
    }


def load_state() -> dict[str, Any]:
    state = read_json(STATE_PATH)
    if not isinstance(state, dict):
        return new_state()
    for key, default in new_state().items():
        state.setdefault(key, default)
    return state


def save_state(state: dict[str, Any]) -> None:
    state["updatedAt"] = now_iso()
    atomic_write_json(STATE_PATH, state)
