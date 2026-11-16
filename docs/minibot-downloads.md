# AniPlus bot fallback

The existing `animeverse-archive-pipeline.service` is the sole canonical writer.
`tools/tg/animeverse-minibot.conf` enables its optional bot lane. Do not run the
legacy `sync.py` worker beside it.

## Actual path

1. The live AniPlus watcher parses the source post's exact MiniBot deep link,
   requested episode and quality. Missing metadata is not guessed.
2. Ready files are skipped. A compatible file already indexed in the source
   archive is handled by the existing archive copier instead of MiniBot.
3. The same pipeline Telegram client sends the MiniBot start payload. Its reply
   supplies the EndBot link; the pipeline sends that payload to the fixed EndBot.
4. Bot replies must come from the expected sender and be newer than the current
   conversation boundary. Duplicate edits do not repeat the same action.
5. Only recognized membership-verification/file callbacks are used. Existing
   membership is checked for the explicit session account, not inferred from
   access to an invite/chat. The owner approved changing required sponsors:
   only membership buttons on the current EndBot gate are eligible, not ads or
   stale static lists. Joins are spaced and bounded (six links per gate and
   twelve new joins per rolling day); existing memberships are reused.
   Unknown/payment/authentication actions are not executed.
   If Telegram confirms existing membership but EndBot still rejects its
   verification, the lane records `provider-membership-check-rejected` and stops
   new requests rather than repeatedly clicking or joining/leaving channels.
6. Filename/caption, exact title aliases, explicit season/part, episode, quality,
   codec and available year evidence must agree. The source bot shortens long
   filenames; a filename title may be accepted only when it is a meaningful
   prefix of the caption title, while the full structured caption remains the
   authoritative identity. A different season, part, episode or codec still
   fails closed. Reviewed/quarantined pages cannot bypass their per-file policy
   through a bot link.
   An identity-held receipt can be retried once after a proven parser fix. When
   the source message still exists, the exact received document is reused; after
   the source bot's short retention window a fresh verified start is required.
7. The verified Telegram document is copied server-side into the owner's archive
   using a persisted send random ID. Existing identical documents are reused.
   No video is written to local disk. The destination is checked before success.
   A protected source or a Telegram forward-restriction error is held, never
   bypassed by downloading/reuploading or another copy method.
8. Canonical state is saved before SQLite publication is acknowledged. Only
   confirmed ready links enter the catalog, then the normal verified publisher
   handles the website snapshot.

## Live reposts and edits

The original request's `postId` is immutable provenance, not proof that a
repeated link is absent from newer posts. `bot_live_sources` records exact links
in already-merged live posts, with the same page identity, episode and quality.
The lane rebuilds this evidence from parsed posts; a newer `lastPostId` alone
cannot promote unrelated backlog. Reposts do not replace accepted downloads or
reset held receipts. Older posts still require the approved import workflow
unless their exact link is independently present in a live post.

The sole watcher rereads at most 80 live posts every five minutes to detect
edits. Only changed parsed content is rematched. The edit scan cannot advance
the forward cursor past an unscanned backlog, and cannot cross the live boundary.

### Strict new-posts-only cutover (owner-requested)

At 2026-11-04 21:43:25 UTC, the owner asked that live acquisition no longer
drain the accumulated queue. Before cutover, 749 old/live requests were eligible;
708 came from October 29–November 1. Recent successful requests had nevertheless
come from exact links in November 4 reposts, not an arbitrary historical sweep.

The sole writer consumed `data/minibot-live-policy-request.json`, guarded by the
expected live boundary 33123 and observed cursor 33232. The durable policy now
starts at post 33233 and also requires the post's original date to be on/after
the cutover timestamp. This excludes unseen older posts discovered after a
Telegram wait. Edits to posts predating cutover cannot restart their old queue.
Current/new posts can still add exact links through edits; a fresh post may
explicitly repeat an older link. A newer page `lastPostId` is never evidence for
unrelated old links. The cutoff does not reset on restart.

In this mode, automatic starts require exact validated `bot_live_sources`
evidence, not merely an old request's numerical `postId`. Explicitly approved
imports retain their separate permission. A direct resolve/activation retry
cannot bypass the policy. Already-copied receipts still publish; forwarding
recovery may reconcile an existing copy or reuse an already received document,
but cannot manufacture a fresh old `/start` if that source is unavailable.

Verified activation at 21:44:32 UTC left zero eligible requests in the then-known
inventory. All 8,607 request rows, 20 import grants and canonical state/accepted
downloads were byte-for-byte unchanged. Persisted account/peer waits and the
start counter were unchanged. Snapshot:
`data/backups/minibot-strict-live-cutover-20261104T214427Z`.
The existing Telegram wait until 2026-11-05 01:40:44 UTC remains in force; this
policy change is not evidence of a new Telegram receive or a cleared API wait.

## Durability and limits

### Sponsor mute and expiry (owner-approved 2026-11-04)

The guarded lane now mutes mandatory sponsor channels when joining or verifying
them. `minibot_sponsor_memberships` stores immutable channel IDs/access hashes,
known invite/username aliases, successful mute time, and ownership/join/exit
times in the pipeline DB settings. Access hashes and invite URLs stay local.
Only a successful join performed by this lane establishes ownership;
`UserAlreadyParticipant`, pre-existing memberships and legacy `state.sponsors`
records do not. The old resolver wrote legacy records even for already-joined
channels, so their ownership and original join age cannot safely be inferred.

The last nonempty mandatory EndBot gate is saved as
`minibot_sponsors_observed`. A successfully validated and archive-confirmed file
stages a fresh, fully verified gate in `bot_sponsor_receipts`; only publication
of its accepted file promotes `minibot_sponsors_successful`. The snapshot stores
immutable peer IDs and cannot advance from a held/superseded file or an older
publication. Ads, timeouts and identity-held files do not replace that success
snapshot. No prompt/document/advertisement is treated
as proof of an empty requirement list. A receipt reused without a new bot flow
does not manufacture a new requirement list.

Between conversations, at most once every five minutes, maintenance uses those
saved lists, never a fresh `/start`, callback or bot-list request. It leaves at
most one channel per pass, only if owned by this lane, joined strictly more than
24 hours ago, with a success snapshot newer than that join, and absent from
both the last successful list and any newer
observed gate. Required aliases of the same channel protect its immutable peer
ID. Unresolved required identities stop expiry rather than risk leaving a
still-needed alias. The source, source archive, destination and creator/admin
channels are excluded; cleanup targets must be broadcast channels, not groups.
Immediately before leaving, the exact session user's participant role must
still be an ordinary/self member, never admin/creator or another account.
Successful rejoining starts a new 24-hour window, even if an external leave
was never observed by the lane.
FloodWaits are persisted through the existing account/peer wait mechanism;
maintenance shares the lane task and never overlaps a bot conversation.
`botDownloads.sponsorLifecycle` exposes counts only, without private invites or
access hashes. Older unproven memberships are never automatically left.

- `bot_requests` is an additive archive-DB table, not a replacement for accepted
  website download requests/batches/history. Original deep links remain stable.
- A lost copy acknowledgement is reconciled against destination document IDs;
  deterministic Telegram send IDs prevent a fresh duplicate send.
- Only one bot conversation runs at a time. Starts are at least 75 seconds
  apart, with an extra break every ten starts. Source-post updates remain live.
  An operator may surface already-eligible live requests for a reported
  regression with a temporary `data/minibot-priority.json`
  (`{"deepLinks": [...]}`); it cannot add older posts or bypass the live boundary.
- Explicit bot-only waits pause the bot lane. Genuine Telegram API FloodWaits
  are persisted and honored by both lanes, including after restart. Unknown
  limits are held for review rather than retried early.
- `archive-pipeline-status.json` exposes `botDownloads`, including received/copy
  timestamps and a hold reason. These distinguish a real bot receipt from an
  archive-source copy; old legacy records did not preserve that distinction.

The operational enable/migration report and actual receive/copy timestamps are
the evidence of deployment. Source code or an enabled flag alone is not proof
that a file has successfully completed the bot flow.
