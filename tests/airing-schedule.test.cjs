const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/lib/airing-schedule.ts"), "utf8");
const NOW = 1_800_000_000_000;
const FUTURE = new Date(NOW + 3_600_000).toISOString();

function load(airing, metadata = currentMetadata()) {
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
    "./generated-airing.json": airing,
    "./generated-metadata.json": metadata,
  };
  new Function("require", "module", "exports", js)(name => (name in deps ? deps[name] : require(name)), module, module.exports);
  return module.exports;
}

function anime(overrides = {}) {
  return {
    slug: "example-ii",
    title: "نمونه",
    titleEn: "Example II",
    titleJa: "例二",
    year: 2026,
    format: "TV",
    type: "سریال",
    ...overrides,
  };
}

function currentMetadata() {
  return {
    metadata: {
      "example-ii": {
        identity: { titleEn: "Example II", titleJa: "例二" },
        providerId: 99,
        data: { year: 2026 },
      },
    },
  };
}

function entry(overrides = {}) {
  return {
    checkedAt: new Date(NOW).toISOString(),
    identity: { providerId: 99, type: "ANIME", status: "RELEASING", format: "TV", year: 2026 },
    sources: [{ titleEn: "Example II", titleJa: "例二", year: 2026 }],
    nextAiringEpisode: { airingAt: FUTURE, episode: 5 },
    ...overrides,
  };
}

function airing(value) {
  return { version: 1, provider: "anilist", entries: { "99": value } };
}

test("verified source identity returns the real upcoming AniList episode", () => {
  const { getNextAiringEpisode } = load(airing(entry()));
  assert.deepEqual(getNextAiringEpisode(anime(), NOW), {
    episode: 5,
    airingAt: new Date(NOW + 3_600_000).toISOString(),
    source: "anilist",
  });
});

test("a stale source title, roman season or year cannot borrow another entry", () => {
  const { getNextAiringEpisode } = load(airing(entry({
    sources: [{ titleEn: "Example", titleJa: "例", year: 2026 }],
  })));
  assert.equal(getNextAiringEpisode(anime(), NOW), null);
  const roman = load(airing(entry({
    sources: [{ titleEn: "Example III", titleJa: "例三", year: 2026 }],
  })));
  assert.equal(roman.getNextAiringEpisode(anime({ titleEn: "Example III", titleJa: "例三" }), NOW), null);
  const year = load(airing(entry({
    sources: [{ titleEn: "Example II", titleJa: "例二", year: 2025 }],
  })));
  assert.equal(year.getNextAiringEpisode(anime(), NOW), null);
});

test("contradictory identity year and movie/OVA/format confusion fail closed", () => {
  const { getNextAiringEpisode } = load(airing(entry({
    identity: { providerId: 99, type: "ANIME", status: "RELEASING", format: "TV", year: 2020 },
  })));
  assert.equal(getNextAiringEpisode(anime(), NOW), null);
  for (const format of ["MOVIE", "OVA", "TV_SHORT"]) {
    const loaded = load(airing(entry({
      identity: { providerId: 99, type: "ANIME", status: "RELEASING", format, year: 2026 },
    })));
    assert.equal(loaded.getNextAiringEpisode(anime(), NOW), null);
  }
  const movie = load(airing(entry({
    identity: { providerId: 99, type: "ANIME", status: "RELEASING", format: "MOVIE", year: 2026 },
  })));
  assert.equal(movie.getNextAiringEpisode(anime({ slug: "film", format: "MOVIE", type: "فیلم" }), NOW), null);
});

test("finished, cancelled, expired and unknown statuses never expose a date", () => {
  for (const status of ["FINISHED", "CANCELLED", "HIATUS", "UNKNOWN", undefined]) {
    const { getNextAiringEpisode } = load(airing(entry({
      identity: { providerId: 99, type: "ANIME", status, format: "TV", year: 2026 },
    })));
    assert.equal(getNextAiringEpisode(anime(), NOW), null);
  }
  const malformed = load(airing(entry({ identity: undefined })));
  assert.equal(malformed.getNextAiringEpisode(anime(), NOW), null);
});

test("past, infinite, boolean and malformed timestamps are rejected", () => {
  const values = [
    new Date(NOW - 1_000).toISOString(),
    NOW - 1000,
    Infinity,
    -Infinity,
    true,
    false,
    "not-a-date",
    "",
    null,
    Number.MAX_SAFE_INTEGER,
  ];
  for (const airingAt of values) {
    const { getNextAiringEpisode } = load(airing(entry({ nextAiringEpisode: { airingAt, episode: 5 } })));
    assert.equal(getNextAiringEpisode(anime(), NOW), null);
  }
  for (const episode of [0, -1, true, "5", 2.5, null]) {
    const { getNextAiringEpisode } = load(airing(entry({ nextAiringEpisode: { airingAt: FUTURE, episode } })));
    assert.equal(getNextAiringEpisode(anime(), NOW), null);
  }
});

test("Unix-second schedules are accepted but stale cache freshness is not", () => {
  const numeric = load(airing(entry({
    nextAiringEpisode: { airingAt: Math.floor((NOW + 3_600_000) / 1000), episode: 8 },
  })));
  assert.equal(numeric.getNextAiringEpisode(anime(), NOW).episode, 8);
  const stale = load(airing(entry({ checkedAt: new Date(NOW - 6 * 60 * 60 * 1000).toISOString() })));
  assert.equal(stale.getNextAiringEpisode(anime(), NOW), null);
  const noMapping = load(airing(entry()), { metadata: {} });
  assert.equal(noMapping.getNextAiringEpisode(anime(), NOW), null);
});

test("the helper never consumes legacy Telegram nextEpisodeAt", () => {
  const { getNextAiringEpisode } = load(airing(undefined));
  assert.equal(getNextAiringEpisode(anime({ nextEpisodeAt: "2026-11-01T12:00:00Z" }), NOW), null);
});

test("generated airing data contains public schedule metadata only", () => {
  const raw = fs.readFileSync(path.join(root, "src/lib/generated-airing.json"), "utf8");
  assert.equal(JSON.parse(raw).provider, "anilist");
  for (const forbidden of ["chatId", "deepLink", "session", "password", "botToken", "destination_id"]) {
    assert.equal(raw.includes(`"${forbidden}"`), false);
  }
});
