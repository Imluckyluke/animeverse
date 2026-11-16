# Returning to a list without losing your place

`NavigationScroll` is mounted once in the root layout, inside its own Suspense
boundary. Public Next.js pathname/search hooks signal route commits. Scroll
coordinates live on the current browser history entry, not in an account,
cookie, localStorage or a server database.

- Back/Forward and reloads restore that entry's position instantly, without a
  smooth trip down the page or extra animation.
- Fresh anime-page links retain Next's normal scroll-to-top behavior.
- A short loading screen does not clamp a deep saved position: restoration waits
  for the committed document to grow, with a bounded five-second fallback.
- Touch, wheel, pointer and keyboard input cancel a pending restoration. Hash
  targets keep native navigation. Listeners and observers are cleaned up.
- The archive also checkpoints the number of expanded cards, keyed by search,
  filters and collection. It restores them before scrolling, caps the count to
  current results and does not carry a count into a different filter selection.
- URL updates keep the checkpoint and use Next's documented native History API
  integration so search-param hooks and router history remain synchronized.

Regression coverage: `node --test tests/ui-interactions.test.cjs` and
`node tests/scroll-navigation-live.cjs`. The browser test accepts
`AV_SCROLL_TEST_BASE` and exercises mobile/desktop, reduced motion, 90-card
filtered lists, Back/Forward, fresh archive navigation and the home feed. It
requires no account, makes no archive assignments and transfers no video files.
