# Two-tier download cache

The website's in-site download popup joins durable transfer jobs. Legacy
`/download` links redirect back to the anime page and open the same popup;
episode buttons never open a separate preparation tab.
Only a catalog-confirmed `done` quality with an exact public destination
message URL is accepted. No anime/season matching or Telegram archive mutation
is performed here. Existing native `/api/link` clients remain compatible.

## Storage

- Public popular repo: `itisluckyluke-dev/animeverse-popular-downloads`.
- Public temporary repo: `itisluckyluke-dev/animeverse-temporary-downloads`.
- Media is attached to Releases, never committed to Git history.
- First request transfers; concurrent requests join the same source/version key.
- Download history and request IDs are saved in this browser. Account-menu and
  floating download buttons reopen it; navigation and closing the popup do not
  stop jobs. Once the server acknowledges a request, closing the browser cannot
  stop preparation either. Receiving the final file on the user's device still
  requires a download click; 100% means the server copy is verified and ready.
- Download-all selects one exact quality, shows how many episodes have it, and
  stores every accepted episode atomically in a server-side batch. No missing
  quality is guessed or substituted. Waiting batches survive restarts and are
  admitted to the bounded active window without browser-side scheduling.
- Temporary files expire after 24 hours without a download request, never
  immediately after returning a link. Status polling does not extend lifetime.
- After 10 distinct, rate-limited request IDs a temporary file is eligible for
  promotion; existing links receive a 24-hour retirement grace period.
- Default caps: 10 GiB temporary, 20 GiB popular, 40 queued jobs, one transfer
  at a time, files strictly below 2 GiB, at most 900 assets per managed release.
- Bulk requests: at most 2000 episodes per batch and 5000 pending jobs globally.
  Temporary storage pressure defers accepted work instead of dropping it or
  retrying the Telegram API in a tight loop. Temporary links can still expire
  after inactivity; the popup exposes expiration and explicit preparation retry.
- The server streams media through bounded buffers. No video is saved locally.
- GitHub's excessive-bandwidth/IP policies still apply; this is not a guarantee
  of unlimited hosting or an authorization to distribute third-party content.

## Control plane and secrets

The server is behind NAT. A Cloudflare Quick Tunnel transports small API
requests only; video goes directly from Telegram through the worker to GitHub.
The current tunnel origin is published as HMAC-signed, secret-free discovery
metadata. The website verifies the signature, freshness and allowed hostname
before sending authorization. Tunnel restarts publish a replacement origin;
the tunnel has no SLA and a managed domain is preferable for strict uptime.

The local API binds loopback, uses pinned private-CA TLS, and requires an
independent bearer secret. GitHub/Telegram credentials stay server-side.
The website receives only two encrypted production variables: the discovery
URL and the cache API secret. No GitHub token reaches Vercel or browser code.
Private configuration, certificates and state live in
`~/.local/share/animeverse-download-cache/` (0700; secret files 0600).

## Operation

`provision_download_cache.py` creates/reuses the two public cache repos without
changing the app repo. `install_cache_tunnel.py` verifies the official binary's
SHA-256 before installation. The provided systemd units bound resource usage.
`configure_download_cache_web.py` updates only the two feature-owned Vercel
variables. Deploy the website afterwards; do not put private env files in a
deployment snapshot. Both existing archive/publisher services stay independent.

For the account cutover, stop both cache services, provision with the new owner's
credential, then run `migrate_cache_account.py` before restarting. It backs up
SQLite, preserves request/job/batch identities and requeues legacy cached files
for streaming from Telegram to the new repositories. Old asset IDs and cleanup
entries must not be reused against the new owner. The migration never accesses
or deletes anything in the old GitHub account. Update the encrypted discovery
configuration and deploy the new strict owner allowlist before reopening downloads.

`test_download_cache.py` tests queue, quotas, TTL, readiness and deduplication.
`test_cache_live.py` transfers one small actual catalog file and anonymously
downloads the GitHub asset, verifying exact size and SHA-256. Its output is
not proof of browser integration; staged/production browser QA is separate.
