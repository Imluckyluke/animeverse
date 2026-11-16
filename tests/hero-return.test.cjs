const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");

test("hero uses server-published pins; legacy browser drafts cannot hide or replace public titles", () => {
  const store = read("lib/admin-store.ts");
  assert.match(store, /export function useAdminState\(\): AdminState \{\s*return EMPTY_ADMIN;/);
  assert.doesNotMatch(store, /useSyncExternalStore\(subscribeAdmin, adminSnapshot/);
  const data = read("lib/data.ts");
  assert.match(data, /applyPublishedAdmin\(anime/);
  assert.match(data, /return withPins\(out\)/);
  assert.doesNotMatch(store, /useState<AdminState>\(EMPTY_ADMIN\)/);
  const hero = read("components/home/hero.tsx");
  assert.match(hero, /applyAdmin\(candidates, admin\)/);
  assert.doesNotMatch(hero, /useCatalog\(candidates\)/);
  assert.match(hero, /previousPinnedKey\.current !== pinnedKey/);
});

test("extra pinned hero entries survive client navigation", () => {
  const hero = read("components/home/hero.tsx");
  assert.match(hero, /useState<HeroAnime\[\]>\(rememberedFeatures\)/);
  assert.match(hero, /rememberedFeatures = data/);
});

test("refresh waits for browser pins before exposing an anime", () => {
  const hero = read("components/home/hero.tsx");
  assert.match(hero, /useSyncExternalStore\(subscribeHydration, clientReady, serverReady\)/);
  assert.match(hero, /const ready = hydrated && \(!awaitingPinned/);
  assert.match(hero, /if \(!ready\) return/);
  assert.match(hero, /data-hero-loading aria-busy="true"/);
  assert.match(hero, /if \(!ready \|\| reduce/);
  assert.match(hero, /setSettledPinnedKey\(pinnedKey\)/);
});
