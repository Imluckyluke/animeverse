const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
function load(relative, deps = {}) {
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", relative), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(name => deps[name] ?? require(name), module, module.exports);
  return module.exports;
}
const quality = load("src/lib/catalog-quality.ts");
const { applyMetadata } = load("src/lib/metadata-enrichment.ts");

test("catalogue descriptions remove leaked fields, credits, HTML and channel footers", () => {
  for (const row of require("./catalog-quality-cases.json")) {
    assert.equal(quality.cleanSynopsis(row.input), row.expected);
    assert.equal(quality.cleanSynopsis(row.expected), row.expected);
  }
  assert.equal(quality.cleanSeason("WINTER 2025"), "زمستان");
  assert.equal(quality.cleanSeason("پاييز"), "پاییز");
  assert.equal(quality.cleanSeason("نامشخص"), "نامشخص");
});

test("validated enrichment fills unknown year without replacing known facts or titles", () => {
  const row = { slug: "test", titleEn: "Test", titleJa: "テスト", year: 0, season: "نامشخص", highestEpisode: 9, episodes: 2, studio: "—", duration: "" };
  const entries = { test: { identity: { titleEn: "Test", titleJa: "テスト" }, providerId: 1, data: { year: 2024, season: "بهار", totalEpisodes: 12, studio: "Studio" } } };
  assert.equal(applyMetadata(row, entries).year, 2024);
  assert.equal(applyMetadata(row, entries).totalEpisodes, 12);
  assert.equal(row.year, 0);
  assert.equal(applyMetadata({ ...row, titleEn: "Another season" }, entries).year, 0);
  assert.equal(applyMetadata({ ...row, year: 2025 }, entries).year, 2025);
  assert.equal(applyMetadata({ ...row, highestEpisode: 15 }, entries).totalEpisodes, undefined);
});

test("cards show the last indexed number and release year, never the count of indexed rows", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { AnimeCard } = load("src/components/anime-card.tsx", {
    "@/lib/app-context": { useApp: () => ({ isFavorite: () => false, toggleFavorite: () => {} }) },
    "@/lib/catalog": { splitQualities: () => ({ base: ["1080p"], x265: false, all: [] }) },
    "@/lib/catalog-metadata": load("src/lib/catalog-metadata.ts"),
    "@/lib/utils": load("src/lib/utils.ts"),
    "@/components/ui/poster": { Poster: ({ children }) => React.createElement("div", null, children) },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
  });
  const row = { slug: "test", titleEn: "Test", year: 2024, type: "سریال", highestEpisode: 9, availableEpisodes: 2, quality: [] };
  const render = anime => renderToStaticMarkup(React.createElement(AnimeCard, { anime }));
  const html = render(row);
  assert.ok(html.includes("آخرین قسمت ۹"));
  assert.ok(html.includes("۲۰۲۴"));
  assert.equal(html.includes("قسمت ثبت‌شده"), false);
  assert.equal(render({ ...row, year: 0 }).includes("— ۰"), false);
  assert.equal(render({ ...row, type: "فیلم" }).includes("آخرین قسمت"), false);
});
