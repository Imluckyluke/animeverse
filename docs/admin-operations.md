# Server-backed administration

- `/admin` now requires the existing Secure, HttpOnly account session of the unique server-side owner. Everyone else receives a not-found result; no separate admin password form is rendered. An old local account, matching email, editor or reviewer role grants no admin access. The original production key bootstraps the owner's initial password only once; password changes revoke sessions and survive restarts.
- Public users and legacy local accounts cannot enter administrative APIs. Guest personal navigation/history is hidden. Importing legacy preferences is explicit and requires the same signed-in email; stored old password hashes never leave the browser.
- The navigation button is displayed for the exact owner Gmail, including a legacy profile with that email, at the owner's explicit request. This display condition does not authenticate a legacy profile or grant any page/API permission. Passwords and account roles are not changed by this rule.
- Vercel is a same-origin, CSRF-checking proxy. Its service token authenticates the private control tunnel, not the user. The signed discovery file contains no credentials. Episode bytes never cross this tunnel.
- `data/admin.sqlite3` stores users, hashed sessions, preferences, editorial overrides, audit events, expiring previews and durable commands. It must never be committed or copied into a public deployment.
- Catalog edits use compare-and-swap revisions. They do not rewrite canonical source metadata or provider scores. An editorial score is labeled separately. Public visibility, artwork, text and pins take effect after a verified publication.
- Real episode/quality rows can be hidden, not manufactured. Review requires a filename-backed preview, an explicit target, a note and confirmation. The archive's existing sole writer revalidates and applies the individual file ID. Manual decisions never add blanket title aliases. Replacing a ready download is opt-in and preserves old queue/download identities.
- A review command being `applied` means the canonical decision was stored, not that production was published. Publish commands remain `running` until the candidate and production inventories pass verification; failures never become success notifications.
- Manual publication mode pauses automatic promotion, not archive copying or catalog generation. Fixed transfer/storage limits are read-only in the panel.
- Undo appends history and refuses to overwrite subsequent changes. Review undo runs in the sole writer. It does not delete Telegram media or accepted GitHub preparation jobs.
- Private SQLite backups are taken daily using SQLite's online backup API (10 retained). Review applications additionally back up canonical state and the pipeline database (10 retained). A complete offline recovery must stop the writer, keep locks, restore a mutually consistent backup and verify publication; no unrestricted filesystem restore is exposed through HTTP.

Services: `animeverse-admin.service` and `animeverse-admin-tunnel.service`. Their private configuration lives outside the repository under `~/.local/share/animeverse-admin/`. The existing archive, publisher and download services retain their separate credentials and responsibilities.

## Download controls

Pause/resume controls are persisted against the original request ID and verified job/batch ID. A paused subscription cannot halt another active subscription to the same file. The worker checks demand during streaming and abandons an unneeded upload; continuing may restart the current file, not resume at its byte offset. Completed assets remain intact. Browser history removal does not delete shared files or cancel other users' requests. Deletion tombstones prevent another open tab from resurrecting removed history.

Checks: Python `test_admin*.py`, Node `admin-security.test.cjs`, `admin-console.test.cjs`, `account-client.test.cjs`, and the manual read-only `tools/tg/test_admin_live.py`. The browser smoke receives credentials through stdin, does not save them and performs no catalog/user/review mutations.
