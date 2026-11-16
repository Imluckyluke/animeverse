"""Personal account notifications. Bot API token never leaves this host."""
import fcntl
import html
import json
import os
import signal
import time
import urllib.error
import urllib.request

from admin_store import AdminError, AdminStore
from common import DATA, atomic_write_json, fa_digits, now_iso
from notification_store import Notifications

TOKEN_PATH = DATA / 'notify-bot-token'
BOT_META_PATH = DATA / 'notify-bot.json'
SITE_URL = (os.environ.get('AV_PUBLIC_URL') or '').rstrip('/')
RUNNING = True


def read_token():
    value = os.environ.get('TG_NOTIFY_BOT_TOKEN', '').strip()
    if value:
        return value
    return TOKEN_PATH.read_text().strip() if TOKEN_PATH.exists() else ''


TOKEN = ''  # Loaded only by the local authentication/startup process.


def api(method, payload=None, timeout=35):
    if not TOKEN:
        return {'ok': False, 'error_code': 0, 'description': 'missing-token'}
    request = urllib.request.Request('https://api.telegram.org/bot' + TOKEN + '/' + method,
        data=json.dumps(payload or {}, ensure_ascii=False).encode(), headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            return json.loads(error.read())
        except (ValueError, OSError):
            return {'ok': False, 'error_code': error.code}
    except Exception as error:
        # Exception strings may contain authenticated URLs; keep only a type.
        return {'ok': False, 'error_code': 0, 'description': type(error).__name__}


def site(path='account'):
    if path == 'account':
        path = 'login'  # The signed-in account view lives on the existing login route.
    return SITE_URL + '/' + path if SITE_URL == 'https://animeverse-xi.vercel.app' else None


def url_button(text, path):
    value = site(path)
    return {'text': text, 'url': value} if value else {'text': 'راهنما', 'callback_data': 'notify:help'}


def escaped(value):
    return html.escape(str(value or 'دوست انیمه‌دوست')[:100])


class NotificationBot:
    def __init__(self, store, call=api):
        self.store, self.notifications, self._call = store, Notifications(store, store.path.parent), call

    def call(self, method, payload):
        until = float(self.notifications.meta('telegram_wait_until', 0))
        if until > time.time():
            return {'ok': False, 'error_code': 429, 'parameters': {'retry_after': max(1, int(until - time.time()))}}
        result = self._call(method, payload)
        if result.get('error_code') == 429:
            self.notifications.put('telegram_wait_until', time.time() + int((result.get('parameters') or {}).get('retry_after', 60)) + 2)
        return result

    def send(self, chat, text, buttons=None, message_id=None):
        body = {'chat_id': chat, 'text': text, 'parse_mode': 'HTML', 'link_preview_options': {'is_disabled': True}}
        if buttons:
            body['reply_markup'] = {'inline_keyboard': buttons}
        if message_id:
            body['message_id'] = message_id
            result = self.call('editMessageText', body)
            if result.get('ok') or 'message is not modified' in str(result.get('description', '')).lower():
                return result
            body.pop('message_id')
        return self.call('sendMessage', body)

    def menu(self, chat, first_name='', message_id=None, heading=''):
        connection = self.notifications.connection(chat)
        if not connection or connection['disabled']:
            text = (f'سلام {escaped(first_name)} 👋\n\n'
                    'اینجا اعلان شخصی قسمت‌های جدید انیمه‌ورس را می‌گیری.\n'
                    'برای اتصال امن، وارد حساب سایت شو و «اتصال به ربات تلگرام» را بزن؛ سپس لینک را باز کن و Start بزن.\n'
                    'فقط انیمه‌های علاقه‌مندیِ همان حساب دنبال می‌شوند.')
            return self.send(chat, heading + text, [[url_button('ورود و اتصال حساب', 'account')],
                             [{'text': 'راهنمای اعلان‌ها', 'callback_data': 'notify:help'}]], message_id)
        status = self.notifications.status(connection['user_id'])
        enabled = status['enabled']
        text = (f'سلام <b>{escaped(connection["name"])}</b> 👋\n\n'
                '✅ حساب سایتت به همین تلگرام متصل است.\n'
                f'🔔 اعلان قسمت جدید: <b>{"روشن" if enabled else "خاموش"}</b>\n'
                f'❤️ علاقه‌مندی‌های حساب: <b>{fa_digits(status["favoritesCount"])}</b> انیمه\n\n'
                'فقط بعد از آماده‌شدن فایل و تأیید انتشار صفحهٔ عمومی پیام می‌فرستم؛ کپی آرشیو یا کیفیت تکراری، اعلان تازه نیست.')
        if not status['favoritesCount']:
            text += '\n\nبرای شروع، در سایت قلب کنار انیمه‌های دلخواهت را بزن.'
        return self.send(chat, heading + text, [
            [{'text': '🔕 خاموش کردن اعلان' if enabled else '🔔 روشن کردن اعلان', 'callback_data': 'notify:off' if enabled else 'notify:on'}],
            [{'text': '❤️ علاقه‌مندی‌های من', 'callback_data': 'notify:favorites'}, {'text': '🔄 وضعیت اتصال', 'callback_data': 'notify:status'}],
            [url_button('حساب من در سایت', 'account'), {'text': 'راهنما', 'callback_data': 'notify:help'}],
            [{'text': 'قطع اتصال حساب', 'callback_data': 'notify:unlink'}]], message_id)

    def favorites(self, chat, message_id=None):
        connection = self.notifications.connection(chat)
        if not connection or connection['disabled']:
            return self.menu(chat, message_id=message_id)
        favorites = self.store.preferences(connection['user_id'])['favorites']
        titles = []
        for slug in favorites[:8]:
            row = self.store.db.execute('SELECT title FROM notify_publications WHERE slug=?', (slug,)).fetchone()
            if row and row['title']:
                titles.append('• ' + escaped(row['title']))
        text = f'❤️ <b>{escaped(connection["name"])}</b>، {fa_digits(len(favorites))} انیمه در علاقه‌مندی‌ها داری.\n\n'
        text += '\n'.join(titles) if titles else 'برای انتخاب انیمه‌ها، در سایت قلب کنار عنوان را بزن.'
        if len(favorites) > len(titles):
            text += '\n\nفهرست کامل و وضعیت صفحه‌ها در حساب سایت است.'
        return self.send(chat, text, [[url_button('دیدن و ویرایش علاقه‌مندی‌ها', 'favorites')],
                                     [{'text': 'بازگشت به منوی من', 'callback_data': 'notify:status'}]], message_id)

    def handle(self, update):
        callback = update.get('callback_query')
        message = (callback or {}).get('message') if callback else update.get('message')
        if not isinstance(message, dict):
            return
        chat = message.get('chat') or {}
        sender = (callback or {}).get('from') if callback else message.get('from')
        sender = sender or {}
        if chat.get('type') != 'private' or str(chat.get('id')) != str(sender.get('id')):
            if callback:
                self.call('answerCallbackQuery', {'callback_query_id': callback['id'], 'text': 'تنظیمات شخصی فقط در گفت‌وگوی خصوصی ربات است.', 'show_alert': True})
            return
        chat_id, first = chat['id'], sender.get('first_name', '')
        message_id = message.get('message_id') if callback else None
        if callback:
            self.call('answerCallbackQuery', {'callback_query_id': callback['id']})
            action = str(callback.get('data', ''))
            if not action.startswith('notify:'):
                return
            command = action.removeprefix('notify:')
        else:
            text = str(message.get('text') or '').strip()
            parts = text.split(maxsplit=1)
            command = parts[0].split('@')[0].lstrip('/').lower() if parts else ''
            if command == 'start' and len(parts) == 2:
                try:
                    self.notifications.redeem(parts[1], chat_id)
                    return self.menu(chat_id, first, heading='✅ اتصال امن حساب انجام شد.\n\n')
                except AdminError as error:
                    return self.send(chat_id, escaped(str(error)), [[url_button('لینک تازه از حساب سایت', 'account')]])
        connection = self.notifications.connection(chat_id)
        if command in {'on', 'off', 'stop', 'unsubscribe'}:
            if connection and not connection['disabled']:
                self.notifications.preference(connection['user_id'], command == 'on')
                heading = '🔔 اعلان‌ها روشن شد.\n\n' if command == 'on' else '🔕 اعلان‌ها خاموش شد؛ علاقه‌مندی‌هایت محفوظ است.\n\n'
                return self.menu(chat_id, first, message_id, heading=heading)
            return self.menu(chat_id, first, message_id)
        if command == 'unlink':
            return self.send(chat_id, 'اتصال حساب سایت به این تلگرام قطع شود؟\nعلاقه‌مندی‌ها و حساب سایت حذف نمی‌شوند.', [[
                {'text': 'بله، قطع اتصال', 'callback_data': 'notify:unlink-confirm'},
                {'text': 'نه، بازگشت', 'callback_data': 'notify:status'}]], message_id)
        if command == 'unlink-confirm':
            if connection:
                self.notifications.unlink(connection['user_id'])
            return self.menu(chat_id, first, message_id, heading='اتصال قطع شد؛ اطلاعات سایتت محفوظ است.\n\n')
        if command == 'favorites':
            return self.favorites(chat_id, message_id)
        if command == 'help':
            return self.send(chat_id, 'راهنمای اعلان‌های انیمه‌ورس 🌱\n\n'
                '۱. با حساب خودت وارد سایت شو و ربات را وصل کن.\n'
                '۲. قلب انیمه‌های موردعلاقه‌ات را بزن.\n'
                '۳. بعد از انتشار قسمت تازه با فایل آماده، همین‌جا پیام می‌گیری.\n\n'
                'خاموش‌کردن اعلان، علاقه‌مندی‌ها را پاک نمی‌کند. قطع اتصال هم حساب سایت را حذف نمی‌کند.\n'
                'رمز عبور و کد ورودت را برای ربات یا شخص دیگری نفرست.',
                [[{'text': 'منوی شخصی من', 'callback_data': 'notify:status'}], [url_button('تنظیمات حساب سایت', 'account')]], message_id)
        return self.menu(chat_id, first, message_id)

    def drain(self, limit=10):
        n = self.notifications
        if float(n.meta('telegram_wait_until', 0)) > time.time():
            return
        rows = self.store.db.execute("SELECT o.*,r.slug,r.title,r.episodes FROM notify_outbox o JOIN notify_releases r ON r.id=o.release_id WHERE o.state='pending' AND retry_at<=? ORDER BY o.id LIMIT ?", (time.time(), limit)).fetchall()
        processed_chats = set()
        for row in rows:
            if row['chat_id'] in processed_chats:
                continue
            current = n.connection(row['chat_id'])
            if (not current or current['user_id'] != row['user_id'] or current['disabled'] or not current['enabled']
                    or row['slug'] not in self.store.preferences(row['user_id'])['favorites']):
                self.store.db.execute("UPDATE notify_outbox SET state='skipped',error='preferences-or-connection-changed' WHERE id=?", (row['id'],))
                continue
            processed_chats.add(row['chat_id'])
            self.store.db.execute("UPDATE notify_outbox SET state='sending',attempts=attempts+1 WHERE id=? AND state='pending'", (row['id'],))
            numbers = json.loads(row['episodes'])
            episodes = '، '.join(fa_digits(value) for value in numbers[:8])
            if len(numbers) > 8:
                episodes += f' و {fa_digits(len(numbers) - 8)} قسمت دیگر'
            episode_label = 'قسمت' if len(numbers) == 1 else 'قسمت‌های'
            text = (f'سلام {escaped(current["name"])} 👋\n\n🎬 <b>{escaped(row["title"])}</b>\n'
                    f'{episode_label} {episodes} با فایل معتبر روی سایت منتشر شد.\nاین پیام برای علاقه‌مندی‌های حساب تو است.')
            result = self.send(row['chat_id'], text, [[url_button('دیدن قسمت و دانلود', 'anime/' + row['slug'])],
                               [{'text': 'تنظیم اعلان‌های من', 'callback_data': 'notify:status'}]])
            if result.get('ok'):
                self.store.db.execute("UPDATE notify_outbox SET state='sent',message_id=?,sent_at=?,error='' WHERE id=?", ((result.get('result') or {}).get('message_id'), now_iso(), row['id']))
                continue
            code = result.get('error_code', 0)
            if code == 429:
                delay = int((result.get('parameters') or {}).get('retry_after', 60)) + 2
                until = time.time() + delay
                n.put('telegram_wait_until', until)
                self.store.db.execute("UPDATE notify_outbox SET state='pending',retry_at=?,error='telegram-rate-limit' WHERE id=?", (until, row['id']))
                break
            if code in {400, 403}:
                self.store.db.execute("UPDATE notify_outbox SET state='blocked',error='telegram-delivery-denied' WHERE id=?", (row['id'],))
                if code == 403:
                    self.store.db.execute('UPDATE notify_accounts SET enabled=0 WHERE user_id=?', (row['user_id'],))
            elif code:
                self.store.db.execute("UPDATE notify_outbox SET state='pending',retry_at=?,error='telegram-temporary-error' WHERE id=?", (time.time() + min(900, 30 * 2 ** min(row['attempts'], 5)), row['id']))
            else:
                # Bot API has no idempotent send key. Do not automatically send
                # a second copy after an ambiguous network acknowledgement.
                self.store.db.execute("UPDATE notify_outbox SET state='uncertain',error='delivery-acknowledgement-unknown' WHERE id=?", (row['id'],))

    def health(self, state='running'):
        counts = dict(self.store.db.execute('SELECT state,count(*) FROM notify_outbox GROUP BY state'))
        atomic_write_json(self.notifications.data / 'notify-bot-health.json', {'state': state, 'heartbeat': time.time(), 'updatedAt': now_iso(), 'outbox': counts})


def main():
    global RUNNING, TOKEN
    os.umask(0o077)
    TOKEN = read_token()
    if not TOKEN or site() is None:
        raise SystemExit('Notification token or verified public site configuration missing')
    DATA.mkdir(exist_ok=True)
    with (DATA / 'notify-bot.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        store = AdminStore(DATA / 'admin.sqlite3')
        bot = NotificationBot(store)
        me = api('getMe', timeout=20)
        if not me.get('ok') or not (me.get('result') or {}).get('is_bot'):
            raise SystemExit('Notification bot authentication failed')
        identity = me['result']
        atomic_write_json(BOT_META_PATH, {'id': identity['id'], 'username': identity['username'], 'name': identity.get('first_name', ''), 'updatedAt': now_iso()})
        api('setMyCommands', {'commands': [{'command': key, 'description': label} for key, label in [
            ('start', 'اتصال حساب و منوی شخصی'), ('status', 'وضعیت اتصال و اعلان‌های من'),
            ('favorites', 'علاقه‌مندی‌های حساب من'), ('on', 'روشن کردن اعلان قسمت جدید'),
            ('stop', 'خاموش کردن اعلان‌ها'), ('help', 'راهنما و حریم خصوصی')]]})
        api('setMyDescription', {'description': 'اعلان شخصی قسمت‌های تازهٔ انیمه‌های موردعلاقه‌ات در انیمه‌ورس؛ بعد از آماده‌شدن فایل و انتشار معتبر روی سایت. اتصال از حساب سایت، بدون دریافت رمز عبور.'})
        api('setMyShortDescription', {'short_description': 'قسمت تازهٔ انیمه‌های موردعلاقه‌ات را از دست نده 🌱 | اتصال امن از حساب انیمه‌ورس'})
        api('setChatMenuButton', {'menu_button': {'type': 'commands'}})
        store.db.execute("UPDATE notify_outbox SET state='uncertain',error='worker-restarted-during-send' WHERE state='sending'")
        def stop(*_):
            global RUNNING
            RUNNING = False
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        bot.health()
        print('NOTIFICATION_ACCOUNT_BOT_READY', flush=True)
        try:
            while RUNNING:
                wait = float(bot.notifications.meta('telegram_wait_until', 0)) - time.time()
                if wait > 0:
                    bot.health('waiting')
                    time.sleep(min(wait, 5))
                    continue
                updates = api('getUpdates', {'offset': int(bot.notifications.meta('update_offset', 0)), 'timeout': 20, 'allowed_updates': ['message', 'callback_query']}, timeout=30)
                if updates.get('ok'):
                    for update in updates.get('result', []):
                        try:
                            bot.handle(update)
                            bot.notifications.put('update_offset', int(update['update_id']) + 1)
                        except Exception as error:
                            print('NOTIFICATION_UPDATE_FAILED', type(error).__name__, flush=True)
                            break
                else:
                    delay = int((updates.get('parameters') or {}).get('retry_after', 8)) + 2
                    bot.notifications.put('telegram_wait_until', time.time() + delay)
                bot.drain()
                bot.health()
        finally:
            bot.health('stopped')
            store.close()


if __name__ == '__main__':
    main()
