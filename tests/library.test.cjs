const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
function load(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)((name) => dependencies[name] ?? require(name), module, module.exports);
  return module.exports;
}
const { parseLibrary, nextAvailableEpisode } = load("src/lib/library.ts");
const { faNum, faScore } = load("src/lib/utils.ts");
test("library storage only accepts supported statuses", () => {
  for (const value of [null, [], false, "watching"]) assert.deepEqual(parseLibrary(value), {});
  assert.deepEqual(parseLibrary({ one: "watching", two: "completed", three: "planned", four: "paused", bad: "done", "": "watching" }),
    { one: "watching", two: "completed", three: "planned", four: "paused" });
});
test("next action uses real numbers, respects gaps and never invents episode one", () => {
  assert.equal(nextAvailableEpisode([8, 3, 1], []), 1);
  assert.equal(nextAvailableEpisode([8, 3, 1], [1]), 3);
  assert.equal(nextAvailableEpisode([8, 3, 1], [3]), 8);
  assert.equal(nextAvailableEpisode([14, 15], []), 14);
  assert.equal(nextAvailableEpisode([1, 2], [1, 2]), null);
  assert.equal(nextAvailableEpisode([], [1]), null);
  assert.equal(nextAvailableEpisode([0, -1, NaN, 1.5, 3, 3], [-10, NaN]), 3);
});
test("Persian number output is deterministic across server and browser ICU versions", () => {
  assert.equal(faScore(8.4), "۸٫۴");
  assert.equal(faScore(9), "۹٫۰");
  assert.equal(faNum(1234567), "۱٬۲۳۴٬۵۶۷");
  assert.equal(faNum(12.5), "۱۲٫۵");
  assert.equal(faNum(Infinity), "—");
});
test("home sends only the small feature pool, and fresh episodes precede discovery", () => {
  const page = fs.readFileSync(path.join(__dirname, "../src/app/page.tsx"), "utf8");
  assert.ok(page.includes("heroPool.map"));
  assert.equal(page.includes("...ANIME.filter"), false);
  assert.ok(page.indexOf("<ContinueWatching") < page.indexOf("<LatestEpisodes"));
  assert.ok(page.indexOf("<LatestEpisodes") < page.indexOf("<HomeRail"));
});

test("library control is a themed popup trigger, never the browser's native select", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  for (const library of [{}, { test: "watching" }]) {
    const { LibraryControl } = load("src/components/library-control.tsx", {
      "@/lib/app-context": { useApp: () => ({ library, setLibraryStatus: () => {} }) },
      "@/lib/library": load("src/lib/library.ts"),
      "@/lib/utils": load("src/lib/utils.ts"),
    });
    const html = renderToStaticMarkup(React.createElement(LibraryControl, { slug: "test" }));
    assert.equal(html.includes("<select"), false);
    assert.ok(html.includes('aria-haspopup="listbox"'));
    assert.ok(html.includes('aria-expanded="false"'));
    assert.ok(html.includes(library.test ? "دنبال می‌کنم" : "افزودن به کتابخانه"));
  }
});

test("detail keeps the original download and heart in one mobile action row", () => {
  const detail = fs.readFileSync(path.join(__dirname, "../src/components/anime/anime-detail-hero.tsx"), "utf8");
  assert.ok(detail.includes('href="#episodes"'));
  assert.ok(detail.includes("flex flex-nowrap items-center gap-2 sm:flex-wrap"));
  assert.equal(detail.includes("EpisodeActions"), false);
  assert.equal(detail.includes("شروع از قسمت"), false);
});

test("public about information does not expose channel provenance", () => {
  const about = fs.readFileSync(path.join(__dirname, "../src/app/anime/[slug]/page.tsx"), "utf8");
  assert.equal(about.includes("منبع اطلاعات"), false);
  assert.equal(about.includes("تلگرام"), false);
  assert.equal(about.includes("AniPlus"), false);
});

test("the library shows only categories with saved titles, not six empty folders", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  function render(state) {
    const { FavoritesView } = load("src/components/favorites-view.tsx", {
      "@/lib/app-context": { useApp: () => ({ ready: true, favorites: [], watched: {}, library: {}, setLibraryStatus: () => {}, ...state }) },
      "@/lib/admin-store": { useCatalog: items => items },
      "@/components/favorites-folder": { FavoritesFolder: ({ label }) => React.createElement("div", { "data-folder": label }, label) },
      "@/components/loading-previews": { LibraryStoragePreview: () => null },
      "next/link": { default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) },
    });
    return renderToStaticMarkup(React.createElement(FavoritesView, { items: [{ slug: "one" }, { slug: "two" }] }));
  }
  const empty = render({});
  assert.equal(empty.includes("data-folder"), false);
  assert.ok(empty.includes("آمادهٔ اولین انتخاب"));
  const used = render({ favorites: ["one"], library: { two: "watching" }, watched: { two: [1] } });
  assert.equal((used.match(/data-folder=/g) ?? []).length, 3);
  assert.ok(used.includes('data-folder="علاقه‌مندی‌ها"'));
  assert.ok(used.includes('data-folder="در حال دنبال کردن"'));
  assert.ok(used.includes('data-folder="دیده‌شده‌ها"'));
  assert.equal(used.includes('data-folder="تمام‌شده‌ها"'), false);
  assert.equal(render({ favorites: ["missing"] }).includes("data-folder"), false);
});

test("folder scrolling does not trigger opening and labels stay on the glass", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/components/favorites-folder.tsx"), "utf8");
  assert.equal(source.includes("onTouchMove="), false);
  assert.equal(source.includes("onWheel="), false);
  assert.ok(source.includes("onPointerCancelCapture"));
  assert.ok(source.includes("event.detail > 0 && moved"));
  assert.equal(source.includes("[&_.gf-label]:hidden"), false);
  assert.equal(source.includes("description ||"), false);
});

test("folder list keeps native scrolling and hands off to the page at boundaries", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/components/favorites-folder.tsx"), "utf8");
  assert.match(source, /<ul data-folder-list[^\n]*overflow-y-auto overscroll-y-auto/);
  assert.equal(source.includes("overscroll-contain"), false);
  assert.equal(source.includes("onWheel="), false);
  assert.equal(source.includes("onTouchMove="), false);
});

test("both library popup directions share the same frosted surface", () => {
  const control = fs.readFileSync(path.join(__dirname, "../src/components/library-control.tsx"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../src/app/globals.css"), "utf8");
  assert.ok(control.includes('data-side={position.bottom !== undefined ? "top" : "bottom"}'));
  assert.match(css, /\.library-menu \{[\s\S]*?-webkit-backdrop-filter: blur\(16px\) saturate\(155%\)/);
  const topOnly = css.match(/\.library-menu\[data-side="top"\] \{([^}]+)\}/)[1];
  assert.doesNotMatch(topOnly, /background|border|backdrop|shadow/);
});

test("library rows are separated by an inset hairline that never touches the glass frame", () => {
  const control = fs.readFileSync(path.join(__dirname, "../src/components/library-control.tsx"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../src/app/globals.css"), "utf8");
  const dividers = control.match(/className="library-menu-divider"/g) ?? [];
  assert.ok(dividers.length >= 1, "The menu must render the shared divider element");
  assert.ok(control.includes("index > 0 ?"), "Dividers belong between rows, not above the first one");
  const rule = css.match(/\.library-menu-divider \{([^}]+)\}/)?.[1] ?? "";
  assert.match(rule, /width: calc\(100% - 1\.5rem\)/, "The hairline stays inset from the menu walls");
  assert.match(rule, /linear-gradient\(90deg, transparent,/, "The hairline fades at both ends");
  assert.match(rule, /rgba\(240,180,92,\.20\) 50%/, "The centre carries a warm premium accent");
  assert.doesNotMatch(rule, /border-(top|bottom): 1px solid rgba\(255,255,255/, "No hard full-width rules");
});

test("latest episode uses its own release date, never the metadata-post date", () => {
  const { getLatestEpisode } = load("src/lib/catalog-metadata.ts");
  const episode = (number, releasedAt = "") => ({ number, releasedAt, qualities: [] });
  const anime = { sourcePostAt: "2026-10-24T12:00:00Z", episodeData: [episode(9, "2026-10-21T12:00:00Z"), episode(2, "2026-10-23T12:00:00Z")] };
  assert.deepEqual(getLatestEpisode(anime), { number: 9, releasedAt: "2026-10-21T12:00:00Z" });
  assert.deepEqual(getLatestEpisode({ ...anime, episodeData: [episode(9)] }), { number: 9, releasedAt: null });
  assert.deepEqual(getLatestEpisode({ episodeData: [episode(9, "bad-date")] }), { number: 9, releasedAt: null });
  assert.equal(getLatestEpisode({ sourcePostAt: anime.sourcePostAt, episodeData: [] }), null);
  const hero = fs.readFileSync(path.join(__dirname, "../src/components/anime/anime-detail-hero.tsx"), "utf8");
  assert.ok(hero.includes("آخرین اپیزود"));
  assert.equal(hero.includes("آخرین به‌روزرسانی اطلاعات"), false);
  assert.equal(hero.includes("بالاترین شماره در آرشیو"), false);
  assert.equal(hero.includes("sourcePostLabel"), false);
});
