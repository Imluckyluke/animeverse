const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("light is the default while an explicit saved dark choice wins", () => {
 const config = read("tailwind.config.ts");
 assert.ok(config.includes("--av-ink-950, 6 6 9"));
 assert.ok(config.includes("--av-content, 245 247 255"));
 const layout = read("src/app/layout.tsx");
 assert.ok(layout.includes("localStorage.getItem('av_theme')==='dark'?'dark':'light'"));
 assert.ok(layout.includes('data-theme="light"'));
 assert.ok(layout.indexOf("localStorage.getItem('av_theme')") < layout.indexOf("<body"));
});

test("menus have independent frost and amber badges keep dark digits", () => {
 const css=read("src/app/light-theme.css");
 assert.ok(css.includes("rgba(229,221,205,.95)"));
 assert.ok(css.includes("--av-glass: var(--av-menu-glass)"));
 assert.ok(read("src/components/mobile-nav.tsx").includes('leading-[13px] text-[#1a1206]'));
 assert.ok(read("src/components/catalog-view.tsx").includes('bg-amber-400 text-[9px] font-black text-[#1a1206]'));
});

test("light hero pagination keeps a distinct active bronze marker", () => {
 const css=read("src/app/light-theme.css");
 assert.ok(css.includes('.hero-pagination button > span { background: transparent; border: 1px solid #8a7755; box-shadow: none; filter: none; }'));
 assert.ok(css.includes('.hero-pagination button[aria-current="true"] > span'));
 assert.ok(css.includes("background: #80530c"));
});
test("theme control persists explicit choices and synchronizes tabs", () => {
 const source = read("src/components/theme-toggle.tsx");
 assert.ok(source.includes('localStorage.setItem(KEY, next ? "light" : "dark")'));
 assert.ok(source.includes('addEventListener("storage", sync)'));
 assert.ok(source.includes("aria-pressed={light}"));
 assert.ok(source.includes("catch"), "blocked storage must not break the control");
 assert.ok(source.includes("disabled={!ready}"), "a pre-hydration click must not be silently ignored");
});
test("account menu themes only its rounded surface, not its square positioning wrapper", () => {
 const header = read("src/components/header.tsx");
 const wrapper = header.slice(header.indexOf("data-account-menu-positioner"), header.indexOf("ref={menuRef}"));
 assert.equal(wrapper.includes('role="menu"'), false);
 assert.match(header, /ref=\{menuRef\}\s+role="menu"\s+aria-label="حساب کاربری"/);
 assert.ok(header.slice(header.indexOf("ref={menuRef}")).includes("overflow-hidden rounded-2xl"));
});
test("light surfaces cover portals, forms, art captions and embedded widgets", () => {
 const css = read("src/app/light-theme.css");
 for (const token of ['[role="dialog"]','[role="listbox"]',".library-menu-divider",".skeleton",".gf-tint",".hwf-root","[data-art-surface]","color-scheme: light"]) assert.ok(css.includes(token), token);
 assert.ok(read("src/components/ui/poster.tsx").includes("data-art-surface"));
 assert.doesNotMatch(css, /filter:\s*invert/, "artwork must never be inverted");
});

test("glass tint stays translucent and cinema image scrims are not painted cream", () => {
 const css = read("src/app/light-theme.css");
 assert.ok(css.includes("rgba(224,213,191,.3)"));
 assert.ok(css.includes('):not([aria-hidden="true"])'));
 const shelves = read("src/components/home/home-shelves.tsx");
 assert.ok(shelves.includes('data-art-surface className="relative aspect-[16/10]'));
});

test("header theme, account and login targets share the search button size", () => {
 assert.ok(read("src/components/theme-toggle.tsx").includes("theme-toggle icon-btn size-11"));
 const header = read("src/components/header.tsx");
 assert.ok(header.includes("btn btn-glass size-11 shrink-0 p-0"));
 assert.ok(header.includes("group grid size-11 shrink-0"));
});

test("light touch-hover uses a short warm penumbra instead of the dark lift", () => {
 const css = read("src/app/light-theme.css");
 assert.ok(css.includes("article:is(:active,:has(:focus-visible)) .glass-card"));
 assert.ok(css.includes('@media (hover: hover) and (pointer: fine)'));
 assert.ok(css.includes("0 8px 14px -10px rgba(106,81,40,.2)"));
 assert.ok(css.includes('article[class*="group/cinema"] > span[class*="bg-black/"]'));
});

test("light folder bodies are quiet, without removing anime covers from sheets", () => {
 const css = read("src/app/light-theme.css");
 const folder = read("src/components/ui/glass-folder-cards.tsx");
 const back = folder.slice(folder.indexOf('<div className="gf-back"'), folder.indexOf('<svg className="gf-rim gf-back-rim"'));
 assert.doesNotMatch(back, /<img|<ArtCanvas/);
 assert.ok(folder.includes('className="gf-sheet-art"'));
 assert.doesNotMatch(css, /\.gf-sheet-art\s*\{[^}]*display:\s*none/);
 assert.ok(css.includes("#d6bd87 0%,#b99b64 52%,#958268 100%"));
 assert.ok(folder.includes("#4b3925 0%, #302b25 52%, #191819 100%"));
});

test("header search and theme glyphs share amber without filled amber buttons", () => {
 const theme = read("src/components/theme-toggle.tsx");
 assert.ok(theme.includes('theme-sun size-5 text-amber-300'));
 assert.ok(theme.includes('theme-moon size-5 text-amber-300'));
 assert.equal(theme.includes("bg-amber-400"), false);
 const search = read("src/components/command-palette.tsx");
 assert.ok(search.includes('size-5 shrink-0 text-amber-300'));
 assert.ok(read("src/app/light-theme.css").includes(".header-account-disc { background: #e5bd58; color: #352811; }"));
});

test("both themes give primary and glass controls the same convex rim", () => {
 const css = read("src/app/globals.css");
 assert.ok(css.includes("--av-control-shadow: inset 0 1px 0"));
 assert.ok(css.includes(":is(.icon-btn,.btn-glass,.btn-primary,.header-account-disc)"));
 assert.ok(css.includes(":is(:hover,:focus-visible)"));
 const light = read("src/app/light-theme.css");
 assert.ok(light.includes("--av-control-shadow: inset 0 1px 0 rgba(255,255,255,.8)"));
});

test("rails feather actual pixels rather than a solid painted overlay", () => {
 for (const name of ["centered-carousel"]) {
  const source = read(`src/components/ui/${name}.tsx`);
  assert.ok(source.includes("data-fade-left="));
  assert.ok(source.includes("edge-feather"));
  assert.equal(source.includes('"flow-fade flow-fade-'), false);
 }
 assert.ok(read("src/app/globals.css").includes("mask-image: var(--feather-mask)"));
});

test("rails avoid half-viewport gutters and share centre-based focus", () => {
 const slider=read("src/components/ui/centered-carousel.tsx");
 assert.ok(slider.includes("box.left + box.width / 2"));
 assert.ok(slider.includes("goal.current = gesture.start"));
 assert.ok(slider.includes('touch-action') || read('src/app/globals.css').includes('touch-action: pan-y pinch-zoom'));
 assert.ok(read("src/components/ui/coverflow.tsx").includes("<CenteredCarousel"));
 assert.ok(read("src/components/ui/rail.tsx").includes("<CenteredCarousel"));
});

test("step gestures retain the original goal and ignore child capture handoffs", () => {
 const slider=read("src/components/ui/centered-carousel.tsx");
 assert.ok(slider.includes("goal.current = gesture.start"));
 assert.ok(slider.includes("event.target === event.currentTarget"));
 assert.ok(slider.includes("direction === lastDirection"));
 assert.ok(slider.includes("centre(canonical, false)"));
 assert.ok(slider.includes('node?.toggleAttribute("inert", !canonical)'));
});

test("search starts with no selected result and feathers only scrollable content", () => {
 const source=read("src/components/command-palette.tsx");
 assert.ok(source.includes("useState(-1)"));
 assert.equal(source.includes("setCursor(0)"),false);
 assert.ok(source.includes("data-more-below={moreBelow}"));
 assert.ok(source.includes("search-results hide-scrollbar"));
 assert.ok(source.includes("go(results[Math.max(cursor, 0)])"));
});

test("open episodes have a distinct frame and the detail fade is only gently reduced", () => {
 const css=read("src/app/light-theme.css");
 assert.ok(css.includes('.episode-row[data-open="true"]'));
 assert.ok(css.includes("inset -3px 0 0 #a87820"));
 assert.ok(css.includes(".anime-detail-hero .detail-fade { opacity: .9; }"));
 assert.ok(css.includes(".anime-detail-hero .synopsis-viewport p { color: #443c31; }"));
});
