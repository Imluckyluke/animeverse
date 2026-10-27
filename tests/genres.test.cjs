const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.join(__dirname, "..");
const taxonomy = require("../src/lib/genre-taxonomy.json");
const js = ts.transpileModule(fs.readFileSync(path.join(root, "src/lib/genres.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", js)(() => taxonomy, mod, mod.exports);
const { normalizeGenres } = mod.exports;

test("genre normalization splits hashtags, preserves phrases, folds aliases and removes metadata", () => {
  for (const row of require("./genre-cases.json")) {
    assert.deepEqual(normalizeGenres(row.input), row.expected);
    assert.deepEqual(normalizeGenres(row.expected), row.expected, "idempotent");
  }
});

test("entire catalogue produces individual clean deduplicated genre labels", () => {
  const catalogue = require("../src/lib/real-catalog.json");
  const before = JSON.stringify(catalogue);
  const names = new Set();
  for (const anime of catalogue) {
    const normalized = normalizeGenres(anime.genres);
    assert.equal(new Set(normalized).size, normalized.length);
    for (const name of normalized) {
      assert.doesNotMatch(name, /[#_:،]/);
      names.add(name);
    }
  }
  assert.ok(names.size < 100, `Unexpected duplicate/combined genre labels: ${names.size}`);
  assert.ok(names.has("علمی-تخیلی"));
  assert.ok(!names.has("علمی تخیلی"));
  assert.ok(!names.has("مدرسه ای یوری"));
  assert.equal(JSON.stringify(catalogue), before, "source untouched");
});

test("modal clips an inner scrollbar below its fixed header", () => {
  const source = fs.readFileSync(path.join(root, "src/components/ui/modal.tsx"), "utf8");
  assert.match(source, /flex max-h-\[88dvh\][^"\n]*overflow-hidden/);
  assert.match(source, /data-modal-scroll[^\n]*mx-1 mb-1 min-h-0 overflow-y-auto/);
  assert.match(source, /flex shrink-0 items-center/);
});
