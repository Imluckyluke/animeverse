const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/lib/anime-connections.ts"), "utf8");

function load(connections, metadata, identities = { bindings: {} }) {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
  }).outputText;
  const module = { exports: {} };
  const deps = {
    "./generated-connections.json": connections,
    "./generated-metadata.json": metadata,
    "./generated-connection-identities.json": identities,
  };
  new Function("require", "module", "exports", js)(name => (name in deps ? deps[name] : require(name)), module, module.exports);
  return module.exports;
}

function anime(slug, overrides = {}) {
  return {
    slug,
    title: `عنوان ${slug}`,
    titleEn: slug,
    titleJa: `${slug}-ja`,
    year: 2020,
    type: "سریال",
    format: "TV",
    genres: [],
    popularity: 1,
    cover: `/covers/${slug}.jpg`,
    ...overrides,
  };
}

function metadata(entries) {
  return {
    metadata: Object.fromEntries(entries.map(({ slug, id, titleEn, titleJa, year }) => [slug, {
      identity: { titleEn, titleJa },
      providerId: id,
      data: { year },
    }])),
  };
}

function node(id, overrides = {}) {
  return {
    id,
    type: "ANIME",
    titleEn: `Title ${id}`,
    titleJa: `作品${id}`,
    titleRomaji: `Romaji ${id}`,
    year: 2020,
    format: "TV",
    cover: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/${id}.jpg`,
    ...overrides,
  };
}

function edge(relationType, target) {
  return { relationType, node: target };
}

function entry(id, sourceIdentity, overrides = {}) {
  return {
    sourceUrl: `https://anilist.co/anime/${id}`,
    checkedAt: "2026-10-30T00:00:00+00:00",
    identity: { ...node(id), ...sourceIdentity, providerId: id },
    sources: [{ titleEn: sourceIdentity.titleEn, titleJa: sourceIdentity.titleJa, year: sourceIdentity.year }],
    relations: [],
    recommendations: [],
    ...overrides,
  };
}

function connections(entries) {
  return {
    version: 1,
    provider: "anilist",
    checkedAt: "2026-10-30T00:00:00+00:00",
    entries: Object.fromEntries(entries.map(item => [String(item.identity.providerId), item])),
  };
}

function bindings(entries) {
  return {
    version: 1,
    provider: "anilist",
    generatedAt: "2026-10-30T00:00:00+00:00",
    bindings: Object.fromEntries(entries.map(({ slug, id, identity }) => [slug, {
      identity: {
        titleEn: identity.titleEn,
        titleJa: identity.titleJa,
        year: identity.year ?? 0,
        format: identity.format ?? "",
        type: identity.type ?? "سریال",
      },
      providerId: id,
      evidence: { method: "exact-full-title", checkedAt: "2026-10-30T00:00:00+00:00" },
    }])),
  };
}

function binding(slug, id, identity) {
  return { slug, id, identity };
}

const current = anime("current", { titleEn: "Current", titleJa: "カレント" });
const currentSource = { titleEn: "Current", titleJa: "カレント", year: 2020 };
const currentMetadata = metadata([{ slug: "current", id: 1, ...currentSource }]);

test("stale generated-metadata identity yields an honest empty state", () => {
  const staleMetadata = metadata([{ slug: "current", id: 1, titleEn: "Old title", titleJa: "カレント", year: 2020 }]);
  const cache = connections([entry(1, currentSource, { relations: [edge("SEQUEL", node(2))] })]);
  const { getAnimeConnections } = load(cache, staleMetadata);
  const result = getAnimeConnections(current, [current, anime("second")]);
  assert.deepEqual(result.relations, []);
  assert.deepEqual(result.similar, []);
  assert.equal(result.checkedAt, undefined);
});

test("stale cache snapshots are invalidated rather than shown", () => {
  const cache = connections([entry(1, { titleEn: "Old title", titleJa: "カレント", year: 2020 }, {
    relations: [edge("SEQUEL", node(2))],
  })]);
  const { getAnimeConnections } = load(cache, currentMetadata);
  const result = getAnimeConnections(current, [current, anime("second")]);
  assert.deepEqual(result.relations, []);
  assert.equal(result.checkedAt, undefined);
});

test("an exact local source snapshot accepts a verified provider's alternative display title", () => {
  const target = anime("second", { titleEn: "Second", titleJa: "セカンド" });
  const entries = metadata([
    { slug: "current", id: 1, ...currentSource },
    { slug: "second", id: 2, titleEn: "Second", titleJa: "セカンド", year: 2020 },
  ]);
  const cached = entry(1, currentSource, { relations: [edge("SEQUEL", node(2))] });
  cached.identity.titleEn = "Official English display title";
  const { getAnimeConnections } = load(connections([cached]), entries);
  const result = getAnimeConnections(current, [current, target]);
  assert.equal(result.relations.length, 1);
  assert.equal(result.relations[0].href, "/anime/second");
});

test("a provider node with contradictory year cannot become the wrong local remake", () => {
  const target = anime("remake", { titleEn: "Remake", titleJa: "リメイク", year: 2025 });
  const entries = metadata([{ slug: "current", id: 1, ...currentSource }, { slug: "remake", id: 2, titleEn: "Remake", titleJa: "リメイク", year: 2025 }]);
  const { getAnimeConnections } = load(connections([entry(1, currentSource, { relations: [edge("SEQUEL", node(2, { year: 2020 }))] })]), entries);
  const result = getAnimeConnections(current, [current, target]);
  assert.deepEqual(result.relations, []);
  assert.equal(result.relations.some(card => card.slug === "remake"), false);
});

test("duplicate provider IDs do not choose a local page", () => {
  const duplicateMetadata = metadata([
    { slug: "current", id: 1, ...currentSource },
    { slug: "duplicate-a", id: 2, titleEn: "Duplicate A", titleJa: "重複A", year: 2020 },
    { slug: "duplicate-b", id: 2, titleEn: "Duplicate B", titleJa: "重複B", year: 2020 },
  ]);
  const cache = connections([entry(1, currentSource, { relations: [edge("SEQUEL", node(2))] })]);
  const duplicateA = anime("duplicate-a", { titleEn: "Duplicate A", titleJa: "重複A" });
  const duplicateB = anime("duplicate-b", { titleEn: "Duplicate B", titleJa: "重複B" });
  const { getAnimeConnections } = load(cache, duplicateMetadata);
  const result = getAnimeConnections(current, [current, duplicateA, duplicateB]);
  assert.deepEqual(result.relations, []);
  assert.equal(result.relations.some(card => card.href.includes("anilist.co")), false);
});

test("roman seasons are never inferred from similar titles", () => {
  const romanMetadata = metadata([
    { slug: "current", id: 1, ...currentSource },
    { slug: "current-ii", id: 2, titleEn: "Current II", titleJa: "カレント II", year: 2024 },
  ]);
  const secondSeason = anime("current-ii", { titleEn: "Current II", titleJa: "カレント II", year: 2024 });
  const cache = connections([entry(1, currentSource)]);
  const { getAnimeConnections } = load(cache, romanMetadata);
  const result = getAnimeConnections(current, [current, secondSeason]);
  assert.deepEqual(result.relations, []);
  assert.deepEqual(result.similar, []);
});

test("MOVIE, OVA and SPECIAL are labelled apart from TV", () => {
  const targets = [
    anime("movie-target", { titleEn: "Title 2", titleJa: "作品2", format: "MOVIE" }),
    anime("ova-target", { titleEn: "Title 3", titleJa: "作品3", format: "OVA" }),
    anime("special-target", { titleEn: "Title 4", titleJa: "作品4", format: "SPECIAL" }),
    anime("tv-target", { titleEn: "Title 5", titleJa: "作品5", format: "TV" }),
  ];
  const entries = metadata([
    { slug: "current", id: 1, ...currentSource },
    { slug: "movie-target", id: 2, titleEn: "Title 2", titleJa: "作品2", year: 2020 },
    { slug: "ova-target", id: 3, titleEn: "Title 3", titleJa: "作品3", year: 2020 },
    { slug: "special-target", id: 4, titleEn: "Title 4", titleJa: "作品4", year: 2020 },
    { slug: "tv-target", id: 5, titleEn: "Title 5", titleJa: "作品5", year: 2020 },
  ]);
  const cache = connections([entry(1, currentSource, {
    relations: [
      edge("SEQUEL", node(2, { format: "MOVIE" })),
      edge("SIDE_STORY", node(3, { format: "OVA" })),
      edge("SPIN_OFF", node(4, { format: "SPECIAL" })),
      edge("PREQUEL", node(5, { format: "TV" })),
      edge("SEQUEL", { ...node(6), type: "MANGA" }),
    ],
  })]);
  const { getAnimeConnections } = load(cache, entries);
  const result = getAnimeConnections(current, [current, ...targets]);
  const byTitle = Object.fromEntries(result.relations.map(card => [card.titleEn, card]));
  assert.equal(byTitle["Title 2"].relation, "SEQUEL");
  assert.equal(byTitle["Title 2"].format, "MOVIE");
  assert.match(byTitle["Title 2"].label, /فیلم/);
  assert.equal(byTitle["Title 3"].format, "OVA");
  assert.match(byTitle["Title 3"].label, /OVA/);
  assert.equal(byTitle["Title 4"].format, "SPECIAL");
  assert.match(byTitle["Title 4"].label, /ویژه/);
  assert.equal(byTitle["Title 5"].format, "TV");
  assert.match(byTitle["Title 5"].label, /TV/);
  assert.equal(byTitle["Title 6"], undefined, "non-ANIME nodes are dropped");
});

test("external relation targets do not consume local relation slots", () => {
  const target = anime("local-target", { titleEn: "Local Target", titleJa: "ローカル", year: 2020 });
  const entries = metadata([
    { slug: "current", id: 1, ...currentSource },
    { slug: "local-target", id: 2, titleEn: "Local Target", titleJa: "ローカル", year: 2020 },
  ]);
  const external = Array.from({ length: 12 }, (_, index) => edge("SEQUEL", node(100 + index)));
  const cache = connections([entry(1, currentSource, {
    relations: [...external, edge("OTHER", node(2))],
  })]);
  const { getAnimeConnections } = load(cache, entries);
  const result = getAnimeConnections(current, [current, target]);
  assert.deepEqual(result.relations.map(card => card.id), ["anilist:2"]);
  assert.equal(result.relations[0].available, true);
  assert.equal(result.relations[0].href, "/anime/local-target");
});

test("recommendations exclude the current title and known franchise nodes", () => {
  const recMetadata = metadata([
    { slug: "current", id: 1, ...currentSource },
    { slug: "available-rec", id: 3, titleEn: "Available Rec", titleJa: "おすすめ", year: 2021 },
  ]);
  const availableRec = anime("available-rec", { titleEn: "Available Rec", titleJa: "おすすめ", year: 2021 });
  const cache = connections([entry(1, currentSource, {
    relations: [edge("SEQUEL", node(2))],
    recommendations: [node(1), node(2), node(3, { year: 2021 }), node(4)],
  })]);
  const { getAnimeConnections } = load(cache, recMetadata);
  const result = getAnimeConnections(current, [current, availableRec]);
  assert.deepEqual(result.similar.map(card => card.relation), [undefined]);
  assert.deepEqual(result.similar.map(card => card.id), ["anilist:3"]);
  assert.equal(result.similar[0].available, true);
  assert.equal(result.similar[0].href, "/anime/available-rec");
  assert.equal(result.similar.some(card => card.id === "anilist:4"), false);
});

test("a local recommendation is kept after eight external recommendations", () => {
  const target = anime("local-rec", { titleEn: "Local Rec", titleJa: "ローカル推薦", year: 2021 });
  const entries = metadata([
    { slug: "current", id: 1, ...currentSource },
    { slug: "local-rec", id: 3, titleEn: "Local Rec", titleJa: "ローカル推薦", year: 2021 },
  ]);
  const recommendations = [
    ...Array.from({ length: 8 }, (_, index) => node(100 + index)),
    node(3, { titleEn: "Local Rec", titleJa: "ローカル推薦", year: 2021 }),
  ];
  const cache = connections([entry(1, currentSource, { recommendations })]);
  const { getAnimeConnections } = load(cache, entries);
  const result = getAnimeConnections(current, [current, target]);
  assert.deepEqual(result.similar.map(card => card.id), ["anilist:3"]);
  assert.equal(result.similar[0].available, true);
  assert.equal(result.similar[0].href, "/anime/local-rec");
  assert.equal(result.similar.some(card => card.href.includes("anilist.co")), false);
});

test("all-external recommendations fall through to a two-genre local fallback", () => {
  const currentWithGenres = anime("current", { titleEn: "Current", titleJa: "カレント", genres: ["اکشن", "درام"] });
  const entries = metadata([{ slug: "current", id: 1, ...currentSource }]);
  const recommendations = Array.from({ length: 8 }, (_, index) => node(100 + index));
  const cache = connections([entry(1, currentSource, { recommendations })]);
  const actionDrama = anime("action-drama", { genres: ["اکشن", "درام"] });
  const dramaAction = anime("drama-action", { genres: ["درام", "اکشن"] });
  const { getAnimeConnections } = load(cache, entries);
  const result = getAnimeConnections(currentWithGenres, [currentWithGenres, actionDrama, dramaAction]);
  assert.deepEqual(new Set(result.similar.map(card => card.slug)), new Set(["action-drama", "drama-action"]));
  for (const card of result.similar) {
    assert.equal(card.source, "genres");
    assert.equal(card.available, true);
    assert.match(card.href, /^\/anime\//);
  }
});

test("bounded PREQUEL/SEQUEL graph traverses an external bridge without title guesses", () => {
  const graphMetadata = metadata([
    { slug: "current", id: 1, ...currentSource },
    { slug: "season-three", id: 3, titleEn: "Season Three", titleJa: "三期", year: 2022 },
  ]);
  const seasonThree = anime("season-three", { titleEn: "Season Three", titleJa: "三期", year: 2022 });
  const cache = connections([
    entry(1, currentSource, { relations: [edge("SEQUEL", node(2))] }),
    {
      sourceUrl: "https://anilist.co/anime/2",
      checkedAt: "2026-10-30T00:00:00+00:00",
      identity: { ...node(2), providerId: 2 },
      relations: [edge("SEQUEL", node(3, { year: 2022 }))],
      recommendations: [],
    },
    {
      identity: { ...node(3, { year: 2022 }), providerId: 3 },
      relations: [edge("PREQUEL", node(4))], // A different direction is not after the current work.
    },
  ]);
  const { getAnimeConnections } = load(cache, graphMetadata);
  const result = getAnimeConnections(current, [current, seasonThree]);
  const graphCard = result.relations.find(card => card.id === "anilist:3");
  assert.ok(graphCard);
  assert.equal(graphCard.available, true);
  assert.equal(graphCard.relation, "SEQUEL");
  assert.match(graphCard.label, /دنباله/);
  assert.match(graphCard.reason, /زنجیره/);
  assert.equal(result.relations.some(card => card.id === "anilist:2"), false, "the external bridge is not displayed");
  assert.equal(result.relations.every(card => card.available && card.href.startsWith("/anime/")), true);
  assert.equal(result.relations.some(card => card.id === "anilist:4"), false, "chains retain the original before/after direction");
});

test("genre fallback requires two actual shared genres and never fills randomly", () => {
  const genreMetadata = metadata([{ slug: "current", id: 1, ...currentSource }]);
  const actionOnly = anime("action-only", { genres: ["اکشن"] });
  const actionDrama = anime("action-drama", { genres: ["اکشن", "درام"] });
  const dramaAction = anime("drama-action", { genres: ["درام", "اکشن"] });
  const unrelated = anime("unrelated", { genres: ["کمدی"] });
  const cache = connections([entry(1, currentSource)]);
  const { getAnimeConnections } = load(cache, genreMetadata);
  const result = getAnimeConnections(anime("current", {
    titleEn: "Current", titleJa: "カレント", genres: ["اکشن", "درام"],
  }), [current, actionOnly, actionDrama, dramaAction, unrelated]);
  assert.deepEqual(new Set(result.similar.map(card => card.slug)), new Set(["action-drama", "drama-action"]));
  for (const card of result.similar) {
    assert.equal(card.source, "genres");
    assert.equal(card.label, "بر اساس ژانر");
    assert.match(card.reason, /حداقل دو ژانر مشترک/);
    assert.equal(card.available, true);
  }
  assert.equal(result.similar.some(card => card.slug === "action-only"), false);
  assert.equal(result.similar.some(card => card.slug === "unrelated"), false);
});

test("a bound unknown-year full season title links without inventing a year", () => {
  const target = anime("season-two", {
    titleEn: "Example Show 2nd Season",
    titleJa: "Example Show 2nd Season",
    year: 0,
    format: "TV",
  });
  const entries = metadata([{ slug: "current", id: 1, ...currentSource }]);
  const cache = connections([
    entry(1, currentSource, { relations: [edge("SEQUEL", node(2, {
      titleEn: "Example Show 2nd Season", titleJa: "Example Show 2nd Season", year: 2020,
    }))] }),
  ]);
  const identities = bindings([binding("season-two", 2, {
    titleEn: "Example Show 2nd Season", titleJa: "Example Show 2nd Season", year: 0, format: "TV",
  })]);
  const { getAnimeConnections } = load(cache, entries, identities);
  const result = getAnimeConnections(current, [current, target]);
  assert.deepEqual(result.relations.map(card => card.slug), ["season-two"]);
  assert.equal(result.relations[0].year, 2020);
  assert.equal(result.relations[0].href, "/anime/season-two");
});

test("a stale identity binding is ignored instead of choosing a changed page", () => {
  const target = anime("renamed-target", {
    titleEn: "A Newly Renamed Show", titleJa: "新しい題名", year: 2024,
  });
  const entries = metadata([{ slug: "current", id: 1, ...currentSource }]);
  const cache = connections([
    entry(1, currentSource, { relations: [edge("SEQUEL", node(2, { year: 2024 }))] }),
  ]);
  const identities = bindings([binding("renamed-target", 2, {
    titleEn: "Old Unchanged Show", titleJa: "古い題名", year: 2024, format: "TV",
  })]);
  const { getAnimeConnections } = load(cache, entries, identities);
  const result = getAnimeConnections(current, [current, target]);
  assert.deepEqual(result.relations, []);
  assert.equal(result.relations.some(card => card.slug === "renamed-target"), false);
});

test("an identity binding conflicting with explicit metadata fails closed", () => {
  const target = anime("conflict-target", { titleEn: "Conflict Target", titleJa: "衝突", year: 2020 });
  const entries = metadata([{ slug: "current", id: 1, ...currentSource }, {
    slug: "conflict-target", id: 9, titleEn: "Conflict Target", titleJa: "衝突", year: 2020,
  }]);
  const cache = connections([
    entry(1, currentSource, { relations: [edge("SEQUEL", node(2))] }),
  ]);
  const identities = bindings([binding("conflict-target", 2, {
    titleEn: "Conflict Target", titleJa: "衝突", year: 2020, format: "TV",
  })]);
  const { getAnimeConnections } = load(cache, entries, identities);
  const result = getAnimeConnections(current, [current, target]);
  assert.deepEqual(result.relations, []);
});

test("duplicate identity bindings never pick one of two local pages", () => {
  const first = anime("duplicate-a", { titleEn: "Duplicate A", titleJa: "重複A", year: 2020 });
  const second = anime("duplicate-b", { titleEn: "Duplicate B", titleJa: "重複B", year: 2020 });
  const entries = metadata([{ slug: "current", id: 1, ...currentSource }]);
  const cache = connections([
    entry(1, currentSource, { relations: [edge("SEQUEL", node(2))] }),
  ]);
  const identities = bindings([
    binding("duplicate-a", 2, { titleEn: "Duplicate A", titleJa: "重複A", year: 2020, format: "TV" }),
    binding("duplicate-b", 2, { titleEn: "Duplicate B", titleJa: "重複B", year: 2020, format: "TV" }),
  ]);
  const { getAnimeConnections } = load(cache, entries, identities);
  const result = getAnimeConnections(current, [current, first, second]);
  assert.deepEqual(result.relations, []);
});

test("a remake year conflict and a different roman part stay unlinked", () => {
  const remake = anime("remake", { titleEn: "Remake", titleJa: "リメイク", year: 2025 });
  const partTwo = anime("part-two", {
    titleEn: "Example Show 2nd Season Part 2", titleJa: "例 2nd Season Part 2", year: 2021,
  });
  const entries = metadata([{ slug: "current", id: 1, ...currentSource }]);
  const cache = connections([
    entry(1, currentSource, {
      relations: [
        edge("SEQUEL", node(2, { titleEn: "Remake", titleJa: "リメイク", year: 2020 })),
        edge("SEQUEL", node(3, { titleEn: "Example Show 2nd Season Part 1", year: 2020 })),
      ],
    }),
  ]);
  const identities = bindings([
    binding("remake", 2, { titleEn: "Remake", titleJa: "リメイク", year: 2025, format: "TV" }),
    binding("part-two", 4, { titleEn: "Example Show 2nd Season Part 2", year: 2021, format: "TV" }),
  ]);
  const { getAnimeConnections } = load(cache, entries, identities);
  const result = getAnimeConnections(current, [current, remake, partTwo]);
  assert.deepEqual(result.relations, []);
  assert.equal(result.relations.some(card => card.slug === "remake" || card.slug === "part-two"), false);
});

test("hidden pages and the current page are never linked", () => {
  const visible = anime("visible", { titleEn: "Visible", titleJa: "表示", year: 2020 });
  const hidden = anime("hidden", { titleEn: "Hidden", titleJa: "非表示", year: 2020 });
  const entries = metadata([{ slug: "current", id: 1, ...currentSource }]);
  const cache = connections([
    entry(1, currentSource, {
      relations: [edge("SEQUEL", node(2)), edge("SEQUEL", node(1))],
    }),
  ]);
  const identities = bindings([
    binding("visible", 2, { titleEn: "Visible", titleJa: "表示", year: 2020, format: "TV" }),
    binding("hidden", 2, { titleEn: "Hidden", titleJa: "非表示", year: 2020, format: "TV" }),
  ]);
  const { getAnimeConnections } = load(cache, entries, identities);
  // The hidden slug is absent from the public catalogue; its binding must not
  // create a destination.  The visible row cannot share the same provider ID
  // without becoming ambiguous, so this fixture withholds both.
  const result = getAnimeConnections(current, [current, visible]);
  assert.equal(result.relations.some(card => card.slug === "hidden"), false);
  assert.equal(result.relations.some(card => card.slug === "current"), false);
  assert.equal(result.relations.every(card => card.href.startsWith("/anime/")), true);
});

test("one franchise links every local view through an external support node", () => {
  const first = anime("show-1", { titleEn: "Show 2nd Season", titleJa: "ショー 2nd Season", year: 2020 });
  const second = anime("show-2", { titleEn: "Show 3rd Season", titleJa: "ショー 3rd Season", year: 2022 });
  const third = anime("show-3", { titleEn: "Show 4th Season", titleJa: "ショー 4th Season", year: 2024 });
  const entries = metadata([]);
  const support = {
    ...entry(99, { titleEn: "Show 2nd Season Part 2", titleJa: "ショー 2nd Season Part 2", year: 2021 }, {
      relations: [
        edge("PREQUEL", node(11, { titleEn: "Show 2nd Season", titleJa: "ショー 2nd Season", year: 2020 })),
        edge("SEQUEL", node(12, { titleEn: "Show 3rd Season", titleJa: "ショー 3rd Season", year: 2022 })),
      ],
    }),
    sources: [], support: true,
  };
  const cache = connections([
    entry(11, { titleEn: "Show 2nd Season", titleJa: "ショー 2nd Season", year: 2020 }, {
      relations: [edge("SEQUEL", node(99, { titleEn: "Show 2nd Season Part 2", titleJa: "ショー 2nd Season Part 2", year: 2021 }))],
    }),
    support,
    entry(12, { titleEn: "Show 3rd Season", titleJa: "ショー 3rd Season", year: 2022 }, {
      relations: [
        edge("PREQUEL", node(99, { titleEn: "Show 2nd Season Part 2", titleJa: "ショー 2nd Season Part 2", year: 2021 })),
        edge("SEQUEL", node(13, { titleEn: "Show 4th Season", titleJa: "ショー 4th Season", year: 2024 })),
      ],
    }),
    entry(13, { titleEn: "Show 4th Season", titleJa: "ショー 4th Season", year: 2024 }, {
      relations: [edge("PREQUEL", node(12, { titleEn: "Show 3rd Season", titleJa: "ショー 3rd Season", year: 2022 }))],
    }),
  ]);
  const identities = bindings([
    binding("show-1", 11, { titleEn: "Show 2nd Season", titleJa: "ショー 2nd Season", year: 2020, format: "TV" }),
    binding("show-2", 12, { titleEn: "Show 3rd Season", titleJa: "ショー 3rd Season", year: 2022, format: "TV" }),
    binding("show-3", 13, { titleEn: "Show 4th Season", titleJa: "ショー 4th Season", year: 2024, format: "TV" }),
  ]);
  const { getAnimeConnections } = load(cache, entries, identities);
  const catalogue = [first, second, third];
  const linked = Object.fromEntries(catalogue.map(item => {
    const result = getAnimeConnections(item, catalogue);
    return [item.slug, new Set(result.relations.map(card => card.slug))];
  }));
  for (const item of catalogue) {
    for (const other of catalogue) {
      if (other.slug === item.slug) continue;
      assert.equal(linked[item.slug].has(other.slug), true, `${item.slug} must link ${other.slug}`);
    }
    assert.equal(linked[item.slug].has(undefined), false);
    assert.ok(linked[item.slug].size <= 12);
  }
});

test("the three public Re:Zero pages are mutually linked from the shipped data", () => {
  const catalogue = require("../src/lib/real-catalog.json");
  const cache = require("../src/lib/generated-connections.json");
  const entries = require("../src/lib/generated-metadata.json");
  const identities = require("../src/lib/generated-connection-identities.json");
  const pages = catalogue.filter(item => String(item.slug || "").startsWith("re-zero-kara-hajimeru-isekai-seikatsu-"));
  assert.equal(pages.length, 3);
  const { getAnimeConnections } = load(cache, entries, identities);
  for (const page of pages) {
    const result = getAnimeConnections(page, catalogue);
    assert.ok(result.relations.length <= 12);
    assert.ok(result.similar.length <= 8);
    const linked = result.relations.filter(card => card.available).map(card => card.slug);
    for (const other of pages) {
      if (other.slug === page.slug) continue;
      assert.ok(linked.includes(other.slug), `${page.slug} must link ${other.slug}`);
    }
    assert.equal(result.relations.every(card => card.href.startsWith("/anime/")), true);
    assert.equal(result.similar.some(card => pages.some(other => other.slug === card.slug)), false);
  }
});

test("public identity bindings are exact public snapshots, not hidden state", () => {
  const cache = require("../src/lib/generated-connection-identities.json");
  assert.ok(cache.bindings && typeof cache.bindings === "object");
  for (const [slug, binding] of Object.entries(cache.bindings)) {
    assert.equal(typeof slug, "string");
    assert.ok(Number.isSafeInteger(binding.providerId) && binding.providerId > 0);
    assert.equal(typeof binding.identity.titleEn, "string");
    assert.equal(typeof binding.identity.titleJa, "string");
    assert.equal(binding.evidence.method, "exact-full-title");
  }
  assert.ok(Object.keys(cache.bindings).length > 0);
});

test("public cache is bounded, ANIME-only and free of local slugs", () => {
  const cache = require("../src/lib/generated-connections.json");
  assert.ok(cache.entries && typeof cache.entries === "object");
  for (const [key, entry] of Object.entries(cache.entries)) {
    assert.match(key, /^[1-9][0-9]*$/);
    assert.equal(entry.identity.type, "ANIME");
    assert.equal(entry.identity.providerId, Number(key));
    assert.ok(entry.relations.length <= 30);
    assert.ok(entry.recommendations.length <= 15);
    for (const source of entry.sources || []) assert.equal(source.slug, undefined);
    if (entry.support) {
      assert.equal(entry.sources.length, 0);
      assert.equal(entry.recommendations.length, 0);
    }
    for (const relation of entry.relations) {
      assert.equal(relation.node.type, "ANIME");
      assert.ok(relation.relationType);
    }
    for (const recommendation of entry.recommendations) assert.equal(recommendation.type, "ANIME");
  }
});
