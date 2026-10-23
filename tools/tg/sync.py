#!/usr/bin/env python3
"""AniPlus -> AnimeVerse sync worker.

Examples:
  python tools/tg/sync.py --posts 50 --no-resolve --no-watch
  python tools/tg/sync.py --posts 50 --watch
  python tools/tg/sync.py --posts 0 --max-links 2 --no-rebuild   # resolver smoke test
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import os
import signal
import sys
import time
import traceback

from telethon import TelegramClient
from telethon.sessions import StringSession

from catalog import write_catalog
from common import (
    API_HASH,
    API_ID,
    CATALOG_PATH,
    DEST_CHANNEL,
    LOCK_PATH,
    MINIBOT_WAIT_PATH,
    STATE_PATH,
    STATUS_PATH,
    STOP_PATH,
    Status,
    Stopped,
    WATCH_INTERVAL,
    atomic_write_json,
    check_stop,
    clear_stop,
    load_state,
    now_iso,
    pid_alive,
    read_json,
    read_session,
    save_state,
    write_stop,
)
from ingest import ingest_latest, ingest_new, prepare_covers, rebuild_site
from resolver import BotFlow, load_archive, resolve_all


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--posts", type=int, default=50, help="Number of latest anime posts to ingest (0 = none)")
    parser.add_argument("--watch", action="store_true", help="Keep running and poll for new posts")
    parser.add_argument("--no-watch", action="store_true", help="Do not watch (default)")
    parser.add_argument("--no-resolve", action="store_true", help="Only ingest/build, do not resolve download links")
    parser.add_argument("--no-rebuild", action="store_true", help="Write JSON but skip next build/restart")
    parser.add_argument("--max-links", type=int, default=None, help="Stop after N links (testing)")
    parser.add_argument("--retry-failed", action="store_true", help="Retry links previously marked failed")
    parser.add_argument("--job-id", default="")
    return parser.parse_args()


def acquire_lock(job_id: str, posts: int) -> bool:
    current = read_json(LOCK_PATH, {}) or {}
    pid = current.get("pid")
    if pid and pid_alive(pid):
        print(f"Another sync worker is running (pid {pid})", file=sys.stderr)
        return False
    try:
        LOCK_PATH.unlink()
    except FileNotFoundError:
        pass
    atomic_write_json(
        LOCK_PATH,
        {"pid": os.getpid(), "jobId": job_id, "startedAt": now_iso(), "posts": posts},
    )
    return True


def release_lock(job_id: str) -> None:
    current = read_json(LOCK_PATH, {}) or {}
    if current.get("jobId") in {"", job_id} or current.get("pid") == os.getpid():
        try:
            LOCK_PATH.unlink()
        except FileNotFoundError:
            pass


async def _heartbeat(status: Status) -> None:
    while True:
        await asyncio.sleep(3)
        try:
            status.heartbeat()
        except Exception:
            pass


def _restore_minibot_wait(flow: BotFlow, status: Status, previous: dict) -> None:
    """Keep a still-running MiniBot flood wait across worker restarts."""
    candidates = [previous, read_json(MINIBOT_WAIT_PATH, {}) or {}]
    best: tuple[dt.datetime, str, dict] | None = None
    for record in candidates:
        reason = str(record.get("floodReason") or record.get("reason") or "")
        raw = record.get("floodWaitUntil") or record.get("until")
        if "minibot" not in reason.lower() or not raw:
            continue
        try:
            until = dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if until.tzinfo is None:
                until = until.replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
        if until <= dt.datetime.now(dt.timezone.utc):
            continue
        if best is None or until > best[0]:
            best = (until, reason, record)
    if best is None:
        return
    until, reason, record = best
    remaining = int((until - dt.datetime.now(dt.timezone.utc)).total_seconds())
    flow.minibot_blocked_until = time.monotonic() + remaining
    requested = int(
        record.get("floodRequestedSec") or record.get("requestedSec") or remaining
    )
    status.flood(remaining, reason, requested)
    status.log(
        f"⏸ محدودیت قبلی MiniBot هنوز فعال است؛ {max(1, (remaining + 59) // 60)} دقیقه باقی مانده",
        "warn",
    )


async def _watch_ingest_loop(
    client: TelegramClient,
    state: dict,
    status: Status,
    no_rebuild: bool,
    rebuild_lock: asyncio.Lock,
) -> None:
    """Ingest new channel posts while the resolver is working.

    The resolver can spend hours on its backlog (or in a Telegram flood wait).
    Polling here means a new episode still reaches the catalog immediately
    instead of waiting for every old link to finish.
    """
    while True:
        for _ in range(WATCH_INTERVAL):
            check_stop()
            await asyncio.sleep(1)
        check_stop()
        try:
            anime_done, _new_count, _updated_count, changed_keys = await ingest_new(
                client, state, status
            )
            if anime_done == 0:
                continue
            await prepare_covers(state, status)
            save_state(state)
            catalog, _ = write_catalog(state)
            status.update(catalogCount=len(catalog))
            if changed_keys and not no_rebuild:
                async with rebuild_lock:
                    await asyncio.to_thread(rebuild_site, status)
        except asyncio.CancelledError:
            raise
        except Stopped:
            return
        except Exception as exc:
            status.log(
                f"⚠️ خطا در بررسی خودکار پست‌های جدید: {type(exc).__name__} — {exc}",
                "error",
            )
            await asyncio.sleep(15)


async def run(args: argparse.Namespace) -> int:
    job_id = args.job_id or time.strftime("%Y%m%d-%H%M%S")
    if not acquire_lock(job_id, args.posts):
        return 2
    clear_stop()
    previous_status = read_json(STATUS_PATH, {}) or {}
    status = Status(job_id, posts_total=max(0, args.posts))
    status.log(f"ورکر همگام‌سازی شروع شد (job {job_id})")
    state = load_state()
    heartbeat_task: asyncio.Task | None = None
    watch_task: asyncio.Task | None = None
    rebuild_lock = asyncio.Lock()
    client: TelegramClient | None = None
    exit_code = 0

    def on_signal(*_: object) -> None:
        write_stop(job_id)

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, on_signal)
        except NotImplementedError:
            pass

    try:
        client = TelegramClient(
            StringSession(read_session()),
            API_ID,
            API_HASH,
            connection_retries=10,
            request_retries=5,
            timeout=30,
            auto_reconnect=True,
        )
        await client.connect()
        if not await client.is_user_authorized():
            raise RuntimeError("Telegram session is not authorised")
        me = await client.get_me()
        status.log(f"متصل به تلگرام با حساب {getattr(me, 'first_name', '') or getattr(me, 'username', '')}")
        mini = await client.get_entity("AniPlusMiniBot")
        end = await client.get_entity("AniPlusEndBot")
        dest = await client.get_entity(DEST_CHANNEL)
        status.log("ربات‌ها و کانال مقصد آماده‌اند")
        heartbeat_task = asyncio.create_task(_heartbeat(status))

        changed_keys: list[str] = []
        should_rebuild = not CATALOG_PATH.exists()
        if args.posts > 0:
            _, new_count, updated_count, changed_keys = await ingest_latest(
                client, state, status, args.posts
            )
            should_rebuild = should_rebuild or bool(changed_keys) or new_count > 0 or updated_count > 0
            await prepare_covers(state, status)
            save_state(state)
            catalog, links = write_catalog(state)
            status.update(catalogCount=len(catalog))
            status.log(f"کاتالوگ ساخته شد: {len(catalog)} عنوان، {len(links)} لینک آماده")
            if should_rebuild and not args.no_rebuild:
                async with rebuild_lock:
                    await asyncio.to_thread(rebuild_site, status)
            elif args.no_rebuild:
                status.log("ساخت مجدد سایت رد شد (--no-rebuild)", "warn")
        else:
            catalog, links = write_catalog(state)
            status.update(catalogCount=len(catalog))
            status.log(f"کاتالوگ فعلی: {len(catalog)} عنوان، {len(links)} لینک آماده")

        flow = BotFlow(client, mini, end, dest, state, status)
        # Archive-first: most releases can be copied straight from the private
        # archive, so MiniBot only handles what is genuinely missing.
        flow.archive = await load_archive(client, flow)
        _restore_minibot_wait(flow, status, previous_status)
        watch = args.watch and not args.no_watch and args.max_links is None

        # Start looking for new posts immediately. The initial resolver can be
        # busy for hours; catalog updates must not wait for it.
        if watch:
            watch_task = asyncio.create_task(
                _watch_ingest_loop(client, state, status, args.no_rebuild, rebuild_lock)
            )
            status.log(
                f"پایش پست‌های جدید فعال شد (هر {WATCH_INTERVAL // 60} دقیقه، مستقل از صف دانلود)"
            )

        if not args.no_resolve:
            # Muting old sponsor channels is cosmetic. During a MiniBot wait it
            # can trigger an unrelated account FloodWait and overwrite the
            # visible MiniBot window, so postpone it until the lane is free.
            if flow.minibot_blocked_until > time.monotonic():
                status.log("⏭ بی‌صدا کردن اسپانسرهای قدیمی تا پایان محدودیت MiniBot به تعویق افتاد")
            else:
                await flow.mute_known_sponsors()
            resolved, _ = await resolve_all(
                flow,
                state,
                status,
                retry_failed=args.retry_failed,
                max_links=args.max_links,
            )
            catalog, links = write_catalog(state)
            status.update(catalogCount=len(catalog))
            status.log(f"کاتالوگ نهایی: {len(catalog)} عنوان، {len(links)} لینک آماده")
            if resolved and not args.no_rebuild:
                async with rebuild_lock:
                    await asyncio.to_thread(rebuild_site, status)

        if watch:
            while True:
                status.update(
                    state="watching",
                    phase="watch",
                    nextPollAt=(dt.datetime.now(dt.timezone.utc)
                                + dt.timedelta(seconds=WATCH_INTERVAL)).isoformat(),
                    current=None,
                )
                for _ in range(WATCH_INTERVAL):
                    check_stop()
                    await asyncio.sleep(1)
                check_stop()

                if watch_task.done():
                    try:
                        await watch_task
                    except (asyncio.CancelledError, Stopped):
                        raise
                    except Exception as exc:
                        status.log(
                            f"⚠️ پایش‌گر متوقف شد و دوباره راه‌اندازی می‌شود: {type(exc).__name__} — {exc}",
                            "error",
                        )
                    watch_task = asyncio.create_task(
                        _watch_ingest_loop(client, state, status, args.no_rebuild, rebuild_lock)
                    )

                if args.no_resolve:
                    continue
                status.update(state="running", phase="resolve", nextPollAt=None)
                try:
                    resolved, _ = await resolve_all(flow, state, status, retry_failed=False)
                    if resolved:
                        catalog, _ = write_catalog(state)
                        status.update(catalogCount=len(catalog))
                        if not args.no_rebuild:
                            async with rebuild_lock:
                                await asyncio.to_thread(rebuild_site, status)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    status.log(f"⚠️ خطا در پردازش لینک‌های تازه: {type(exc).__name__} — {exc}", "error")
                    await asyncio.sleep(15)

        status.finish("done", "همگام‌سازی با موفقیت تمام شد")
        exit_code = 0
    except Exception as exc:
        if isinstance(exc, Stopped):
            status.finish("stopped", "توسط کاربر متوقف شد")
            exit_code = 0
        else:
            detail = "".join(traceback.format_exception_only(type(exc), exc)).strip()
            status.log(f"خطای جدی: {detail}", "error")
            status.finish("error", "ورکر با خطا متوقف شد")
            exit_code = 1
    finally:
        if watch_task:
            watch_task.cancel()
            try:
                await watch_task
            except (asyncio.CancelledError, Exception):
                pass
        if heartbeat_task:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except (asyncio.CancelledError, Exception):
                pass
        if client is not None:
            try:
                await client.disconnect()
            except Exception:
                pass
        release_lock(job_id)
    return exit_code


def main() -> None:
    args = parse_args()
    try:
        code = asyncio.run(run(args))
    except KeyboardInterrupt:
        code = 0
    raise SystemExit(code)


if __name__ == "__main__":
    main()
