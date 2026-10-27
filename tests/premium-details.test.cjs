const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("hero pagination keeps a 44px-tall hit area without growing the dots", () => {
  const source = read("src/components/home/hero.tsx");
  assert.match(source, /before:-inset-y-2\.5/, "the invisible hit area extends above and below the dot");
  assert.match(source, /i === index \? "w-\[26px\] bg-amber-400 shadow-\[/, "the active dot carries the warm glow");
});

test("mobile tabs fill their column and give touch feedback", () => {
  const source = read("src/components/mobile-nav.tsx");
  assert.match(source, /"relative flex h-full w-full flex-col/, "the whole grid column is tappable");
  assert.ok(source.includes("active:scale-[.96]"));
  assert.ok(source.includes("dock-tray"));
  assert.ok(source.includes("dock-item"));
});

test("breadcrumbs and the login eye respect a comfortable touch target", () => {
  const hero = read("src/components/anime/anime-detail-hero.tsx");
  assert.ok(hero.includes('aria-current="page"'), "the current crumb is announced and not a link");
  assert.ok((hero.match(/min-h-10 items-center px-1\.5/g) ?? []).length >= 2, "crumb links are padded to 40px tall");
  const auth = read("src/components/auth-view.tsx");
  assert.ok(auth.includes("grid size-10 place-items-center rounded-full text-content-faint"));
});

test("section heads share the inset hairline language", () => {
  const head = read("src/components/ui/section-head.tsx");
  assert.ok(head.includes("section-head mb-5"), "the rule is attached to the shared head");
  const css = read("src/app/globals.css");
  const rule = css.match(/\.section-head::after \{([^}]+)\}/)?.[1] ?? "";
  assert.match(rule, /linear-gradient\(90deg, transparent/, "the rule fades at both ends");
  assert.match(rule, /bottom: -10px/);
  const latest = read("src/components/home/latest-episodes.tsx");
  assert.ok(latest.includes("section-head mb-4"), "the home custom head uses the same class");
});

test("chip rails dissolve at their edges and the header keeps its clean pill", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\.chip-rail \{[\s\S]*?mask-image: linear-gradient\(90deg, transparent/);
  assert.equal(css.includes("header-glass"), false, "no fade plate under the header");
  const header = read("src/components/header.tsx");
  assert.equal(header.includes("header-glass"), false);
  const catalog = read("src/components/catalog-view.tsx");
  assert.ok(catalog.includes("chip-rail mt-4"));
});

test("returning home resumes the hero slide and restarts its wait", () => {
  const hero = read("src/components/home/hero.tsx");
  assert.match(hero, /let rememberedIndex = 0;/);
  assert.match(hero, /useState\(rememberedIndex\)/);
  assert.match(hero, /rememberedIndex = index;/);
  assert.match(hero, /window\.setTimeout\(\(\) => setIndex/);
});

test("the hero's bottom edge cannot flash a seam into the rails", () => {
  const page = read("src/app/page.tsx");
  assert.ok(page.includes("-mt-0.5 bg-ink-950"), "the rails overlap the hero by a hairline");
  const hero = read("src/components/home/hero.tsx");
  assert.ok(hero.includes("from-ink-950 via-ink-950/35 to-transparent"));
  assert.equal(hero.includes("from-ink-950/90"), false, "the fade reaches full page colour");
});

test("glass cards carry an inner light seam and press feedback", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /box-shadow: 0 12px 40px -18px rgba\(0, 0, 0, \.85\), inset 0 1px 0 rgba\(255, 255, 255, \.12\)/);
  const card = read("src/components/anime-card.tsx");
  assert.ok(card.includes("active:scale-[.985]"));
});

test("detail facts speak in latest-episode language, not archive counts", () => {
  const hero = read("src/components/anime/anime-detail-hero.tsx");
  assert.equal(hero.includes("قسمت ثبت‌شده"), false);
  assert.ok(hero.includes("آخرین قسمت ${faDigits(latestEpisode.number)}"));
  assert.ok(hero.includes("latestEpisodeDateLabel"), "the latest episode keeps its own date");
});

test("download preparation moves into a per-episode progress surface", () => {
  const source = read("src/components/anime/episode-list.tsx");
  assert.ok(source.includes("startDownload("));
  assert.ok(source.includes("<Check className=\"size-3 text-emerald-300\" />"));
  const center = read("src/components/downloads/download-center.tsx");
  assert.ok(center.includes('role="progressbar"'));assert.ok(center.includes('progressPercent(item)'));
  const css = read("src/app/downloads.css");
  assert.match(css, /@keyframes download-pending/);assert.ok(css.includes('prefers-reduced-motion'));
});

test("mobile sheets show a grabber and empty states sit on a lit plate", () => {
  const modal = read("src/components/ui/modal.tsx");
  assert.match(modal, /mx-auto mt-2\.5 h-1 w-10 shrink-0 rounded-full[^>]*sm:hidden/);
  const favorites = read("src/components/favorites-view.tsx");
  assert.ok(favorites.includes("empty-plate glass-card"));
  const catalog = read("src/components/catalog-view.tsx");
  assert.ok(catalog.includes("empty-plate glass-card"));
});

test("route changes fade in instead of snapping", () => {
  const template = read("src/app/template.tsx");
  assert.ok(template.includes('className="page-enter"'));
  const css = read("src/app/globals.css");
  assert.match(css, /\.page-enter \{\s*animation: page-enter 220ms/);
});
