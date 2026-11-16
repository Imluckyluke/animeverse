# Approved AniPlus post imports

The owner-only admin Settings tab contains an extraction card. The first input
previews 1–50 latest channel messages; the second accepts one exact public
`https://t.me/aniplus/<message-id>` link. It does not fetch arbitrary hosts,
channels, private invite links or bot start URLs supplied by a browser.

## Approval boundary

- The API stores a durable preview request in the additive `post_imports` table.
  The existing sole archive writer reads source messages through its own Telegram
  client. The HTTP process never receives Telegram credentials or writes the
  canonical catalog.
- A preview contains source title, original title, supported format/year evidence,
  poster, synopsis, episodes and quality labels. Unknown fields remain unknown.
  Previewing never starts a bot conversation or merges canonical state.
- Only an explicit, CSRF-protected owner confirmation can approve a ready preview.
  The approval expires after fifteen minutes. A repeated confirmation returns
  the same operation, rather than creating another batch.
- Before merging, the worker refetches the exact previewed message IDs and checks
  their parsed content hashes and existing target identity fingerprints. Changed,
  deleted, reviewed/quarantined, hidden or season-conflicting sources fail closed.
- Approved files are added to the existing archive-first process. Existing ready
  links and original accepted download requests are not replaced. The public
  catalog continues to require actual verified ready files; registration in the
  acquisition queue is not presented as a published page.

## Bounded bot acquisition

`bot_import_sources` records exactly the file links from approved previews and
prioritizes them over automatic new releases. The first live-only activation sets
`minibot_live_after_post` to the current channel boundary, so enabling the lane
does not unleash the legacy historical backlog. Older posts need explicit import
approval. Existing per-file identity, cooldown, sponsor and protected-content
guards remain in force. No second bot worker is started.

Tests use fake Telegram messages and temporary databases. A production browser
preview test may read the supplied AniPlus post but must never click its import
confirmation without the owner's separate approval of that preview.
