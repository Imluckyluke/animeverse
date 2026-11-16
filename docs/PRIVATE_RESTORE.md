# Private restore notes

The website source and public assets belong in this repository. Runtime data
and authentication material do not. A GitHub clone alone is not a database or
credentials backup.

## Restore an intentionally stopped deployment

1. Clone the private repository and install the locked dependencies.
2. Create private environment configuration using `.env.example` as the list of
   variable names. Replace placeholders; do not commit real values.
3. With all application writers stopped, restore the verified SQLite snapshots:
   - `admin.sqlite3`: accounts, preferences, administration and notifications.
   - `archive-pipeline.sqlite3`: archive processing state and catalog bindings.
   - `download-cache.sqlite3`: the private download-cache state, originally
     configured outside the repository.
4. Keep database files and private directories owner-readable only. Verify the
   hash manifest and SQLite integrity before starting writers.
   Reset legacy administrator/owner passwords and invalidate old web sessions
   before exposing a restored deployment. An old administrator key reused a
   public service identifier and must not be reused as a password or API key.
5. Telegram user authorization must be established afresh after its previous
   session has been revoked. Store the new session only in an ignored private
   file or a secret environment variable. Do not reset unrelated account
   authorizations.
6. The notification bot is a separate Bot API identity. Its retained token and
   metadata must stay outside Git and outside database exports. Do not revoke
   or recreate that bot merely to restore the website.
7. Reconfigure the private admin/cache bridges, then deliberately re-enable the
   required `animeverse-*` services and timers. Do not enable a monitor or
   publisher before checking the restored data and destination configuration.
8. Resume the matching Vercel project only after the backend is configured and
   validated. An intentional project pause does not require deleting its source
   or deployment history.

Encrypted database exports contain private account data and password hashes.
Never upload them, their archive password, `.env.local`, bot tokens, or Telegram
session files to GitHub. Retain private configuration separately from the
clean environment template.
