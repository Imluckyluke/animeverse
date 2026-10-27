const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// Same lightweight TypeScript loader as ui-interactions.test.cjs; no browser.
function load(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(
    (name) => dependencies[name] ?? require(name), module, module.exports,
  );
  return module.exports;
}

const search = load("src/lib/search.ts");
const { normalizeSearchText, searchTitles } = search;
const { searchAnime } = load("src/lib/catalog.ts", { "./search": search });
const titles = [
  { slug: "frieren", title: "سفر فریرن", titleEn: "Frieren: Beyond Journey's End", titleJa: "葬送のフリーレン" },
  { slug: "demon-slayer", title: "شیطان‌کش", titleEn: "Demon Slayer: Kimetsu no Yaiba", titleJa: "鬼滅の刃" },
  { slug: "jujutsu-kaisen", title: "جوجوتسو کایزن", titleEn: "Jujutsu Kaisen", titleJa: "呪術廻戦" },
  { slug: "one-piece", title: "وان پیس", titleEn: "One Piece", titleJa: "ワンピース" },
];
const slugs = (items) => items.map((item) => item.slug);

test("normalizes Persian/Arabic yeh and kaf, diacritics, tatweel, accents and punctuation", () => {
  assert.equal(normalizeSearchText("  كِيمِيا ـ ي  "), "کیمیا ی");
  assert.equal(normalizeSearchText("POKÉMON: The—Movie!"), "pokemon the movie");
  assert.equal(normalizeSearchText("شیطان‌کش"), normalizeSearchText("شیطان کش"));
  assert.deepEqual(slugs(searchTitles(titles, "جُوجوتسو كايزن")), ["jujutsu-kaisen"]);
});

test("matches half-space, ordinary/no/extra spaces and punctuation consistently", () => {
  for (const query of ["شیطانکش", "شیطان کش", "شیطان‌کش", "شیطان   کش"]) {
    assert.deepEqual(slugs(searchTitles(titles, query)), ["demon-slayer"]);
  }
  for (const query of ["ONEPIECE", " One---Piece! ", "one  piece"]) {
    assert.deepEqual(slugs(searchTitles(titles, query)), ["one-piece"]);
  }
});

test("searches every available title alias, including Japanese and slug", () => {
  for (const query of ["سفر فریرن", "BEYOND JOURNEY", "葬送のフリーレン", "FRIEREN"]) {
    assert.deepEqual(slugs(searchTitles(titles, query)), ["frieren"]);
  }
  assert.deepEqual(slugs(searchTitles([{ slug: "unique-alias", title: "چیز دیگر" }], "unique alias")), ["unique-alias"]);
  assert.deepEqual(searchTitles([{ titleEn: "Pokémon" }], "pokemon"), [{ titleEn: "Pokémon" }]);
});

test("tolerates small missing, extra, replaced and transposed letters", () => {
  for (const query of ["friren", "frieeren", "friexen", "frieern", "friren beyond", "onepice", "فریرنن"]) {
    const expected = query === "onepice" ? "one-piece" : "frieren";
    assert.equal(searchTitles(titles, query)[0]?.slug, expected, query);
  }
});

test("allows at most two edits across a long multiword query", () => {
  assert.equal(searchTitles(titles, "friren beynd")[0]?.slug, "frieren");
  assert.deepEqual(searchTitles(titles, "friren beynd jurney"), []);
  assert.deepEqual(searchTitles([{ titleEn: "Frieren no" }], "frieren on"), []);
});

test("does not fuzz short fragments or season numbers, or return unrelated text", () => {
  assert.deepEqual(searchTitles([{ titleEn: "Car" }], "cat"), []);
  assert.deepEqual(searchTitles([{ titleEn: "Naruto Season 2" }], "naruto season 3"), []);
  assert.deepEqual(searchTitles(titles, "zzzzzzzz"), []);
  assert.deepEqual(searchTitles(titles, "totally unrelated adventure"), []);
  assert.deepEqual(searchTitles(titles, "frieren slayer"), []);
});

test("requires all query words in one alias, but permits reordered title words", () => {
  assert.deepEqual(slugs(searchTitles(titles, "kaisen jujutsu")), ["jujutsu-kaisen"]);
  assert.equal(searchTitles([{ titleEn: "Heroes Hero" }], "hero heroes").length, 1);
  assert.deepEqual(searchTitles(titles, "فریرن beyond"), []);
  assert.deepEqual(searchTitles([{ titleEn: "Naruto" }], "naruto narutp"), []);
});

test("ranks exact titles before prefixes, substrings and fuzzy results", () => {
  const input = [
    { slug: "typo", titleEn: "Friren" },
    { slug: "substring", titleEn: "The Frieren Story" },
    { slug: "prefix", titleEn: "Frieren Season 2" },
    { slug: "exact", titleEn: "Frieren" },
  ];
  assert.deepEqual(slugs(searchTitles(input, "frieren")), ["exact", "prefix", "substring", "typo"]);
  assert.deepEqual(slugs(input), ["typo", "substring", "prefix", "exact"]);
});

test("caps fuzzy suggestions without capping literal matches, with stable ties", () => {
  const fuzzy = Array.from({ length: 30 }, (_, i) => ({ slug: `fuzzy-${i}`, titleEn: "Friren" }));
  const literal = Array.from({ length: 20 }, (_, i) => ({ slug: `exact-${i}`, titleEn: "Frieren" }));
  const result = searchTitles([...fuzzy, ...literal], "frieren");
  assert.equal(result.length, 32);
  assert.deepEqual(slugs(result.slice(0, 20)), slugs(literal));
  assert.deepEqual(slugs(result.slice(20)), slugs(fuzzy.slice(0, 12)));
});

test("blank queries preserve order; punctuation-only and oversized queries return nothing", () => {
  assert.deepEqual(searchTitles(titles, " \n "), titles);
  for (const query of ["!!!", "‌", "َُِ", "a".repeat(513), Array(90).fill("frieren").join(" ")]) {
    assert.deepEqual(searchTitles(titles, query), []);
  }
});

test("normalized cache reflects edits to an existing object's title", () => {
  const item = { titleEn: "Frieren" };
  assert.equal(searchTitles([item], "frieren").length, 1);
  item.titleEn = "One Piece";
  assert.deepEqual(searchTitles([item], "frieren"), []);
  assert.equal(searchTitles([item], "onepiece").length, 1);
});

function anime(overrides = {}) {
  return {
    ...titles[0], year: 2023, type: "سریال", status: "پایان یافته", audio: ["دوبله"],
    genres: ["فانتزی"], score: 9, weeklyViews: 100, updatedAt: "2026-10-01", ...overrides,
  };
}

test("archive reuses alias matching while preserving all filters and sort tie-breaks", () => {
  const older = anime({ slug: "older", updatedAt: "2026-09-01", score: 10 });
  const newer = anime({ slug: "newer" });
  const filtered = anime({ slug: "filtered", year: 2020 });
  const input = [older, newer, filtered];
  const opts = { q: "فريِرن", year: 2023, genres: ["فانتزی"], type: "سریال", status: "پایان یافته", audio: "دوبله" };
  assert.deepEqual(slugs(searchAnime(input, opts)), ["newer", "older"]);
  assert.deepEqual(slugs(searchAnime(input, { ...opts, sort: "score" })), ["older", "newer"]);
  assert.deepEqual(searchAnime(input, { ...opts, genres: ["اکشن"] }), []);
  assert.deepEqual(searchAnime(input, { ...opts, type: "فیلم" }), []);
  assert.deepEqual(searchAnime(input, { ...opts, status: "در حال پخش" }), []);
  assert.deepEqual(searchAnime(input, { ...opts, audio: "زیرنویس" }), []);
  assert.deepEqual(slugs(input), ["older", "newer", "filtered"]);
});

test("archive ranks true titles before fuzzy and does not search synopsis noise", () => {
  const unrelated = anime({ slug: "unrelated", title: "دیگر", titleEn: "Another", titleJa: "別", synopsis: "Frieren", studio: "Frieren" });
  const typo = anime({ slug: "typo", title: "", titleEn: "Friren", titleJa: "", updatedAt: "2026-10-20" });
  const exact = anime({ slug: "exact", title: "", titleEn: "Frieren", titleJa: "", updatedAt: "2026-09-01" });
  assert.deepEqual(slugs(searchAnime([unrelated, typo, exact], { q: "frieren" })), ["exact", "typo"]);
});

test("public palette index includes Japanese aliases without episode or download payloads", () => {
  const { GET } = load("src/app/api/catalog-search/route.ts", {
    "next/server": { NextResponse: { json: (body) => body } },
    "@/lib/data": { ANIME: [{ ...anime(), episodeData: [{ secret: true }], watchUrl: "private", synopsis: "not needed" }] },
  });
  const [item] = GET();
  assert.equal(item.titleJa, titles[0].titleJa);
  assert.deepEqual(Object.keys(item).sort(), ["slug", "title", "titleEn", "titleJa", "year", "cover", "banner"].sort());
  assert.equal(searchTitles([item], "葬送のフリーレン").length, 1);
});
