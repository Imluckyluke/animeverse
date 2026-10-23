"""Telegram notification bot for AnimeVerse.

Run separately from the sync worker:

    python tools/tg/notify_bot.py

It long-polls the Bot API for /start <link-code>, stores the chat id against
the browser's anonymous client id, then drains `notify-events.jsonl` written
by the sync worker and sends one grouped message per new episode.
"""
from __future__ import annotations

import html
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import DATA, LOGS, atomic_write_json, fa_digits, now_iso, read_json

TOKEN_PATH = DATA / "notify-bot-token"
LINKS_PATH = DATA / "notify-links.json"
PROFILES_PATH = DATA / "notify-profiles.json"
SUBSCRIPTIONS_PATH = DATA / "notify-subscriptions.json"
EVENTS_PATH = DATA / "notify-events.jsonl"
STATE_PATH = DATA / "notify-bot-state.json"
BOT_META_PATH = DATA / "notify-bot.json"
LOG_PATH = LOGS / "notify-bot.log"
# Never point the bot at a domain that does not belong to the site owner.
# If AV_PUBLIC_URL is empty, messages are sent without a URL button.
SITE_URL = (os.environ.get("AV_PUBLIC_URL") or "").rstrip("/")
LINK_TTL_SECONDS = 20 * 60


def site_link(path: str = "") -> str | None:
    if not SITE_URL:
        return None
    return f"{SITE_URL}/{path.lstrip('/')}" if path else SITE_URL


def log(message: str, level: str = "info") -> None:
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] [{level}] {message}"
    print(line, flush=True)
    # When launched with nohup, stdout already points at the log file. Only
    # write the file directly for interactive runs to avoid duplicate lines.
    if not sys.stdout.isatty():
        return
    try:
        with LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass


def read_token() -> str:
    value = (os.environ.get("TG_NOTIFY_BOT_TOKEN") or "").strip()
    if value:
        return value
    try:
        return TOKEN_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


TOKEN = read_token()
API_ROOT = f"https://api.telegram.org/bot{TOKEN}"


def api(method: str, payload: dict[str, Any] | None = None, timeout: int = 70) -> dict[str, Any]:
    if not TOKEN:
        return {"ok": False, "description": "missing token"}
    body = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{API_ROOT}/{method}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8"))
        except Exception:
            payload = {"ok": False, "description": f"HTTP {exc.code}"}
        if method != "getUpdates":
            log(f"API {method} failed: {payload.get('description') or payload}", "warn")
        return payload
    except Exception as exc:
        return {"ok": False, "description": f"{type(exc).__name__}: {exc}"}


def load_state() -> dict[str, Any]:
    state = read_json(STATE_PATH, {}) or {}
    state.setdefault("lastUpdateId", 0)
    state.setdefault("eventOffset", 0)
    state.setdefault("handledEvents", [])
    state.setdefault("sentEventChats", {})
    state.setdefault("eventRetryAt", {})
    return state


def save_state(state: dict[str, Any]) -> None:
    state["updatedAt"] = now_iso()
    atomic_write_json(STATE_PATH, state)


def load_links() -> dict[str, Any]:
    return read_json(LINKS_PATH, {}) or {}


def load_profiles() -> dict[str, Any]:
    return read_json(PROFILES_PATH, {}) or {}


def load_subscriptions() -> dict[str, Any]:
    return read_json(SUBSCRIPTIONS_PATH, {}) or {}


def parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


def send_message(
    chat_id: int | str,
    text: str,
    button_text: str | None = None,
    button_url: str | None = None,
) -> bool:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if button_text and button_url:
        payload["reply_markup"] = {
            "inline_keyboard": [[{"text": button_text, "url": button_url}]]
        }
    result = api("sendMessage", payload, timeout=25)
    if not result.get("ok"):
        log(f"sendMessage to {chat_id} failed: {result.get('description')}", "warn")
    return bool(result.get("ok"))


def handle_start(message: dict[str, Any], text: str) -> None:
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if not chat_id:
        return
    from_user = message.get("from") or {}
    username = from_user.get("username") or ""
    parts = text.split(maxsplit=1)
    code = parts[1].strip() if len(parts) > 1 else ""

    if not code:
        send_message(
            chat_id,
            "سلام! 👋\nبرای وصل کردن حسابت به اعلان‌های انیمه‌ورس، از پنل حساب کاربری سایت روی «اتصال به ربات تلگرام» بزن.",
            "باز کردن پنل حساب",
            site_link("login"),
        )
        return

    links = load_links()
    entry = links.get(code)
    expires = parse_time(entry.get("expiresAt") if isinstance(entry, dict) else None)
    if not entry or not expires or expires < datetime.now(timezone.utc):
        if entry:
            links.pop(code, None)
            atomic_write_json(LINKS_PATH, links)
        send_message(
            chat_id,
            "این لینک اتصال منقضی شده است. از پنل حساب کاربری سایت یک لینک تازه بگیر.",
            "باز کردن پنل حساب",
            site_link("login"),
        )
        return

    client_id = str(entry.get("clientId") or "")
    if not client_id:
        send_message(chat_id, "لینک اتصال معتبر نیست. دوباره از سایت تلاش کن.")
        return

    profiles = load_profiles()
    subscriptions = load_subscriptions()
    profile = profiles.get(client_id) or {}
    profile["favorites"] = profile.get("favorites") or []
    profile["enabled"] = True
    profile["updatedAt"] = now_iso()
    profiles[client_id] = profile

    # One Telegram chat should only point at the most recently linked browser.
    for other_id, subscription in list(subscriptions.items()):
        if str(subscription.get("chatId")) == str(chat_id):
            subscriptions.pop(other_id, None)

    subscriptions[client_id] = {
        "chatId": chat_id,
        "username": username,
        "firstName": from_user.get("first_name") or "",
        "linkedAt": now_iso(),
        "enabled": True,
    }
    links.pop(code, None)
    atomic_write_json(LINKS_PATH, links)
    atomic_write_json(PROFILES_PATH, profiles)
    atomic_write_json(SUBSCRIPTIONS_PATH, subscriptions)

    count = len(profile["favorites"])
    prefs = "فعال" if profile.get("enabled", True) else "خاموش"
    send_message(
        chat_id,
        "✅ حساب شما به اعلان‌های انیمه‌ورس وصل شد.\n"
        f"وضعیت اعلان: <b>{prefs}</b>\n"
        f"تعداد انیمه‌های لایک‌شده: <b>{fa_digits(count)}</b>\n\n"
        "از این به بعد وقتی قسمت جدیدی از آن‌ها منتشر شود، همین‌جا پیام می‌گیری.",
        "مشاهدهٔ علاقه‌مندی‌ها",
        site_link("favorites"),
    )


def handle_stop(message: dict[str, Any]) -> None:
    chat_id = (message.get("chat") or {}).get("id")
    if not chat_id:
        return
    subscriptions = load_subscriptions()
    profiles = load_profiles()
    changed = False
    for client_id, subscription in subscriptions.items():
        if str(subscription.get("chatId")) != str(chat_id):
            continue
        subscription["enabled"] = False
        profile = profiles.get(client_id) or {}
        profile["enabled"] = False
        profile["updatedAt"] = now_iso()
        profiles[client_id] = profile
        changed = True
    if changed:
        atomic_write_json(SUBSCRIPTIONS_PATH, subscriptions)
        atomic_write_json(PROFILES_PATH, profiles)
    send_message(
        chat_id,
        "🔕 اعلان‌ها خاموش شد. برای روشن کردن دوباره از پنل حساب سایت استفاده کن یا /start را بزن.",
        "پنل حساب",
        site_link("login"),
    )


def handle_status(message: dict[str, Any]) -> None:
    chat_id = (message.get("chat") or {}).get("id")
    if not chat_id:
        return
    subscriptions = load_subscriptions()
    profiles = load_profiles()
    client_id = next(
        (key for key, sub in subscriptions.items() if str(sub.get("chatId")) == str(chat_id)),
        "",
    )
    if not client_id:
        send_message(
            chat_id,
            "حساب شما هنوز به سایت وصل نشده است. از پنل حساب کاربری، یک لینک اتصال بگیر.",
            "پنل حساب",
            site_link("login"),
        )
        return
    profile = profiles.get(client_id) or {}
    enabled = bool(profile.get("enabled", True))
    count = len(profile.get("favorites") or [])
    send_message(
        chat_id,
        f"وضعیت اعلان: <b>{'روشن' if enabled else 'خاموش'}</b>\n"
        f"انیمه‌های لایک‌شده: <b>{fa_digits(count)}</b>",
        "تنظیم در سایت",
        site_link("login"),
    )


def handle_update(update: dict[str, Any]) -> None:
    message = update.get("message") or update.get("edited_message")
    if not isinstance(message, dict):
        return
    text = str(message.get("text") or "").strip()
    if not text:
        return
    command = text.split(maxsplit=1)[0].split("@")[0].lower()
    if command == "/start":
        handle_start(message, text)
    elif command in {"/stop", "/unsubscribe"}:
        handle_stop(message)
    elif command in {"/status", "/help"}:
        if command == "/help":
            send_message(
                (message.get("chat") or {}).get("id"),
                "دستورها:\n/start — اتصال حساب\n/stop — خاموش کردن اعلان‌ها\n/status — وضعیت اعلان",
            )
        else:
            handle_status(message)


def event_message(event: dict[str, Any]) -> str:
    title = html.escape(str(event.get("title") or event.get("titleEn") or "انیمه"))
    episodes = [int(item) for item in (event.get("episodes") or []) if str(item).isdigit()]
    if not episodes:
        return ""
    if len(episodes) == 1:
        episode_text = f"قسمت {fa_digits(episodes[0])}"
    else:
        episode_text = "قسمت‌های " + "، ".join(fa_digits(item) for item in episodes)
    return (
        f"🎬 <b>{title}</b>\n"
        f"{episode_text} آمادهٔ تماشا و دانلود است.\n\n"
        "برای دیدن لینک‌ها روی دکمهٔ زیر بزن."
    )


def drain_events(state: dict[str, Any]) -> None:
    if not EVENTS_PATH.exists():
        return
    try:
        size = EVENTS_PATH.stat().st_size
    except OSError:
        return
    offset = int(state.get("eventOffset") or 0)
    if size < offset:
        offset = 0
    if size == offset:
        return

    profiles = load_profiles()
    subscriptions = load_subscriptions()
    handled = set(state.get("handledEvents") or [])
    sent_map: dict[str, list[str]] = state.get("sentEventChats") or {}
    retry_map: dict[str, float] = state.get("eventRetryAt") or {}
    changed = False

    try:
        with EVENTS_PATH.open("rb") as handle:
            handle.seek(offset)
            data = handle.read()
            new_offset = offset + len(data)
    except OSError as exc:
        log(f"reading events failed: {exc}", "warn")
        return

    # The sync worker appends JSONL. If we catch it mid-write, do not advance
    # past the incomplete last line; the next loop will read the whole event.
    if data and not data.endswith(b"\n"):
        cut = data.rfind(b"\n")
        if cut < 0:
            return
        data = data[: cut + 1]
        new_offset = offset + len(data)
    raw_lines = data.splitlines()

    for raw in raw_lines:
        try:
            event = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            continue
        event_id = str(event.get("id") or "")
        slug = str(event.get("slug") or "")
        if not event_id or not slug or event_id in handled:
            continue
        retry_at = float(retry_map.get(event_id) or 0)
        if retry_at > time.time():
            continue
        text = event_message(event)
        if not text:
            handled.add(event_id)
            continue

        sent = set(sent_map.get(event_id) or [])
        eligible: list[tuple[str, int | str]] = []
        for client_id, subscription in subscriptions.items():
            if str(subscription.get("chatId")) in sent:
                continue
            profile = profiles.get(client_id) or {}
            if not profile.get("enabled", True) or not subscription.get("enabled", True):
                continue
            favorites = profile.get("favorites") or []
            if slug not in favorites:
                continue
            chat_id = subscription.get("chatId")
            if chat_id:
                eligible.append((client_id, chat_id))

        if not eligible:
            handled.add(event_id)
            sent_map.pop(event_id, None)
            retry_map.pop(event_id, None)
            changed = True
            continue

        all_sent = True
        for client_id, chat_id in eligible:
            ok = send_message(
                chat_id,
                text,
                "مشاهده و دانلود",
                site_link(f"anime/{slug}"),
            )
            if ok:
                sent.add(str(chat_id))
                changed = True
            else:
                all_sent = False
        sent_map[event_id] = sorted(sent)
        if all_sent:
            handled.add(event_id)
            sent_map.pop(event_id, None)
            retry_map.pop(event_id, None)
        else:
            # Avoid hammering a chat that blocked the bot or a temporary API
            # failure. The event is retried after ten minutes.
            retry_map[event_id] = time.time() + 600
            changed = True
        log(f"notification {event_id}: sent to {len(sent)} chat(s)", "info" if all_sent else "warn")

    # Keep the state compact.
    state["eventOffset"] = new_offset
    state["handledEvents"] = sorted(handled)[-1200:]
    state["sentEventChats"] = {
        key: value for key, value in sent_map.items() if key not in handled
    }
    state["eventRetryAt"] = {
        key: value for key, value in retry_map.items() if key not in handled
    }
    if changed:
        save_state(state)


def main() -> int:
    if not TOKEN:
        log("TG_NOTIFY_BOT_TOKEN or data/notify-bot-token is missing", "error")
        return 2
    me = api("getMe", timeout=20)
    if not me.get("ok"):
        log(f"getMe failed: {me.get('description')}", "error")
        return 2
    bot = me.get("result") or {}
    username = str(bot.get("username") or "")
    atomic_write_json(
        BOT_META_PATH,
        {
            "id": bot.get("id"),
            "username": username,
            "name": bot.get("first_name") or "",
            "updatedAt": now_iso(),
        },
    )
    log(f"notification bot started (@{username})")
    api(
        "setMyCommands",
        {
            "commands": [
                {"command": "start", "description": "اتصال حساب سایت"}, 
                {"command": "status", "description": "وضعیت اعلان‌ها"},
                {"command": "stop", "description": "خاموش کردن اعلان‌ها"},
                {"command": "help", "description": "راهنما"},
            ]
        },
        timeout=20,
    )

    state = load_state()
    while True:
        try:
            updates = api(
                "getUpdates",
                {
                    "offset": int(state.get("lastUpdateId") or 0),
                    "timeout": 20,
                    "allowed_updates": ["message", "edited_message"],
                },
                timeout=35,
            )
            if updates.get("ok"):
                for update in updates.get("result") or []:
                    update_id = int(update.get("update_id") or 0)
                    if update_id:
                        state["lastUpdateId"] = max(
                            int(state.get("lastUpdateId") or 0), update_id + 1
                        )
                    try:
                        handle_update(update)
                    except Exception as exc:
                        log(f"update handler failed: {type(exc).__name__}: {exc}", "warn")
                save_state(state)
            else:
                description = str(updates.get("description") or "")
                log(f"getUpdates failed: {description}", "warn")
                time.sleep(8)
            drain_events(state)
            time.sleep(0.6)
        except KeyboardInterrupt:
            log("stopped")
            return 0
        except Exception as exc:
            log(f"loop error: {type(exc).__name__}: {exc}", "error")
            time.sleep(6)


if __name__ == "__main__":
    sys.exit(main())
