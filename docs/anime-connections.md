# Anime connections section

The detail page's `#related` section separates franchise relations from similar
recommendations. MyAnimeList's Related Entries / Recommendations distinction
and AniList's typed relations informed the information hierarchy; the actual
Persian RTL card design uses the site's dark and parchment/bronze light skins.

## Identity and availability

Identity-valid metadata bindings, verified AniList URLs, or offline exact full
canonical-title matches establish provider IDs. The latter retain a separate
local identity snapshot, compatible year/format, unique provider match and
evidence; unknown-year titles additionally require a fresh full season-specific
provider entry. Generic franchise prefixes and stripped Roman/part markers never
assign seasons. Changed or contradictory identities fail closed.

Local targets require one unique verified provider binding in the current
public catalogue, with no contradictory year/format. Ambiguous, hidden or
unpublished targets are omitted, never assigned guessed local pages or external
destinations. Only verified local cards count toward display limits. External
nodes can still bridge a verified season chain without being rendered. Movies,
OVA and specials retain explicit format labels.

Previous/next graph traversal is bounded and preserves the original relation
direction. Recommendations exclude known franchise nodes. If provider
local recommendations are unavailable, suggestions require at least two real shared
genres and are labeled genre-based; the old random-fill behavior is not used.

## Data and rendering

`tools/tg/connection_identities.py` maintains bindings and necessary external
PREQUEL/SEQUEL bridge nodes using bounded offline ID batches and HTTP rate waits.
Unchanged identity inputs have a daily refresh cooldown; catalogue identity
changes invalidate it. `generated-connections.json` contains only
public metadata. The resolver runs server-side and passes limited card props;
the catalogue/cache never enters the client bundle and rendering never fetches
the provider API. The verified publisher includes this cache in its content
digest. Empty relation data means unverified, not that no other seasons exist.

Tabs expose counts, keyboard selection and roving focus. Both controlled panels
exist in the DOM; inactive content is hidden. Mobile cards use a native-touch
horizontal rail, while larger screens use a grid. Reduced-motion preferences,
focus indicators and internal-only navigation are preserved. The section has
no marketing heading, introductory description, source button or review date.
Tabs use quiet light/dark text and one thin active line, without count badges,
icons or a raised frame.
