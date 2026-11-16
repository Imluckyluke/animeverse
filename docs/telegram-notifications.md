# Account Telegram notifications

The notification bot is a separate enabled systemd service,
`animeverse-notify.service`. It uses only its Bot API token from the existing
owner-only local file, not the archive worker's Telegram session. No token or
private runtime data belongs in a source commit or Vercel upload.

## Account connection and privacy

- The site's notification endpoints proxy the existing authenticated account
  cookie through the signed control tunnel. Mutations require same-origin and
  CSRF validation. Anonymous browser IDs and client-supplied favorites are not
  identities or a source of truth.
- New connections use a twenty-minute, single-use random Telegram start code.
  Only its SHA-256 hash is stored. Redeeming is restricted to a real private
  chat from the same sender; group chats never receive personal account data.
- A Telegram chat cannot silently switch between two website accounts.
  Disconnect first. Relinking one's own account is explicit.
- Menus use the website account's display name and current server favorites,
  never email, passwords or another account's preferences. HTML is escaped.
  Pausing or unlinking does not delete the account, favorites or history.
- Legacy JSON files remain untouched. Only the uniquely verified owner's old
  connection was recovered locally against its already-authorized private chat;
  unknown legacy browser profiles are not guessed into website accounts.

## Publication and delivery

- The verified publisher is the only release producer. It runs after the
  production alias and complete ready inventory pass verification.
- Initial activation establishes a publication/event baseline and does not
  replay the historical archive. Live source intents are retained durably until
  their exact episodes appear in the verified public inventory. Backfill copies
  and repeated quality links do not create new-episode alerts.
- The outbox is in the same private account SQLite database. Only connected,
  enabled users who currently like that anime are eligible, and preferences
  are checked again before sending. Linking later does not replay older alerts.
- Telegram rate limits and temporary failures retain durable retry deadlines.
  A blocked bot disables delivery. Because Bot API has no idempotent send key,
  ambiguous network acknowledgements or crashes during a send are marked
  `uncertain`, not blindly resent. Health reports expose those counts.
- `notify-bot-health.json` reports heartbeat and outbox states without chat IDs,
  usernames, favorite lists or credentials. The admin service overview includes
  the notification worker.
- The separate signed control tunnel checks its real public HTTP health every
  minute, not just whether `cloudflared` is alive. Three consecutive failures
  recycle only that tunnel and publish a new signed discovery origin; archive
  copying, accepted downloads and the notification bot are not restarted.

## User controls

`/start`, `/status`, `/favorites`, `/on`, `/stop`, `/help` and inline personal
menus provide connection status, current favorites, pause/resume, account links,
help and confirmed unlinking. Starting the menu alone does not undo a user's
paused preference. A notification always identifies an actual published episode;
diagnostic messages are explicitly labeled tests.
