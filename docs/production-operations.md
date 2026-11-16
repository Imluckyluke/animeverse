# Production operations and recovery

## Scope

- Download and concurrent-download behavior was confirmed by the owner. These
  owner checks are not represented as new automated transfer/load tests.
- Service health is checked every two minutes by
  `animeverse-production-monitor.timer`. Notifications go only to the configured
  owner, with failure/recovery deduplication and a durable retry outbox.
- `animeverse-private-backup.timer` schedules a daily recovery snapshot at
  01:00 UTC, with up to five minutes of jitter. Consult systemd for activation;
  installing a unit file alone does not mean the timer is running.

## What the recovery snapshot contains

The explicit snapshot inventory contains the archive SQLite database, account
and preference database, accepted-download/request database, canonical JSON
state, identity evidence, and the current source/public assets. SQLite uses its
online backup API, including WAL. The archive writer is stopped briefly for a
consistent archive DB/JSON checkpoint, then restarted; account and download
services are not stopped. A previously inactive archive writer is not started
by the backup operation.

Videos, Android artifacts, `.env` files, SSH credentials, Telegram session files,
and external service credential configuration files are excluded. Database
snapshots still contain sensitive account/session data and must remain encrypted.

The bundle uses authenticated AES-256-GCM encryption. It is stored as a release
asset in the existing **private** GitHub source repository. A backup release tag
points at an already-pushed commit; source branches and source commits are not
changed. The encrypted bundle includes uncommitted source changes.

The versioned key is stored separately in the existing Vercel project's
**development-only**, encrypted-at-rest environment scope. It is not a
`NEXT_PUBLIC`, preview or production variable. Old keys are not overwritten when
a new key is created. This separates providers, but is not protection against
compromise of both owner accounts.

## Verify the actual outcome

Operational status lives outside source under the owner's private
`animeverse-ops` application-data directory. A successful backup must report:

- `state: verified` and a recent `verifiedAt`;
- the private release/asset ID and the separate Vercel recovery-key reference;
- successful hash checks, SQLite `quick_check`, JSON parsing and source hashes;
- preserved account/preference and request/batch counts.

The backup routine downloads the GitHub asset again, obtains the key through the
Vercel API, decrypts it, and restores to an isolated directory. Successful upload
alone is not a restore test. Failed or stale backups produce an owner alert.

## Recover without the original server

Keep a copy of `tools/ops/recover_backup.py` separately. It needs Python,
`cryptography`, and fresh owner-authorized `GH_TOKEN` and `VERCEL_TOKEN` environment
credentials. Never put credential values in arguments, logs, chat or source.
Find the asset ID and Vercel environment-variable ID in the backup status/release
recovery reference, then run:

```bash
python3 recover_backup.py --asset ASSET_ID --environment ENVIRONMENT_ID --output NEW_EMPTY_DIRECTORY
```

The standalone helper fetches both the encrypted asset and the key from their
separate providers; it does not read the old server's `recovery.key`. It validates
the restored data/source and never overwrites a live installation. A fresh-host
dry-run result must be recorded separately from the routine backup verification.

After verification, provision the application runtime and external service
credentials again. Restore each verified database/state file to its documented
application location while the affected services are stopped. Account password
hashes/preferences and accepted-download identities remain in their databases;
do not reprovision/reset the existing owner account. Regenerate derived catalog
files from restored canonical state before publishing. Preserve the old data
until the replacement is independently verified.

## Limits

- The monitor runs on this server. Total host/network failure needs a separate
  off-host monitor; local monitoring cannot promise an alert after its host dies.
- Archive copying and investigative identity matching are different operations.
  Neither an uploaded file nor a completed copy queue certifies its title/season.
- Link Click's reviewed public page exposes only its individually certified
  season-three-part-one sources. Episode 10 is withheld, not guessed. The old
  duplicate and its history are preserved behind a reversible hidden overlay.
