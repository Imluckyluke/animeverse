const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const componentSource = read("src/components/anime/anime-connections.tsx");
const pageSource = read("src/app/anime/[slug]/page.tsx");

function loadConnections() {
  const js = ts.transpileModule(componentSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const stubs = {
    "next/link": { __esModule: true, default: (props) => require('react').createElement('a', props) },
    "lucide-react": new Proxy({}, { get: () => () => null }),
    react: { useEffect: () => {}, useId: () => "test", useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}] },
    "@/lib/utils": {
      cn: (...parts) => parts.filter(Boolean).join(" "),
      faDigits: (value) => String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]),
      faDate: (value) => `date:${value}`,
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", js)((name) => stubs[name] ?? require(name), module, module.exports);
  return module.exports;
}

const connections = loadConnections();

test("detail page delegates relationships to the server helper and drops the old rail", () => {
  assert.match(pageSource, /import \{ AnimeConnections \} from "@\/components\/anime\/anime-connections"/);
  assert.match(pageSource, /import \{ getAnimeConnections \} from "@\/lib\/anime-connections"/);
  assert.match(pageSource, /await getAnimeConnections\(anime, ANIME\)/);
  assert.match(pageSource, /<AnimeConnections connections=\{connections\} \/>/);
  assert.equal(pageSource.includes("getRelated"), false);
  assert.equal(pageSource.includes("RelatedRail"), false);
  assert.equal(pageSource.includes("SectionHead"), false);
});

test("the client section keeps the #related anchor and never imports the catalogue", () => {
  assert.ok(componentSource.startsWith('"use client"'));
  assert.match(componentSource, /id="related"/);
  assert.match(componentSource, /import type \{ AnimeConnections as ConnectionsData, ConnectionCard \} from "@\/lib\/anime-connections"/);
  assert.equal(componentSource.includes("@/lib/data"), false);
  assert.equal(componentSource.includes("real-catalog"), false);
  assert.equal(componentSource.includes("ANIME"), false);
});

test("two simple tabs expose panel relationships and roving focus without badge clutter", () => {
  assert.match(componentSource, /role="tablist"/);
  assert.match(componentSource, /aria-label="ارتباط‌ها و پیشنهادها"/);
  assert.match(componentSource, /role="tab"/);
  assert.match(componentSource, /aria-selected=\{selected\}/);
  assert.match(componentSource, /aria-controls=\{`connections-panel-\$\{key\}-\$\{base\}`\}/);
  assert.match(componentSource, /tabIndex=\{selected \? 0 : -1\}/);
  assert.match(componentSource, /role="tabpanel"/);
  assert.match(componentSource, /aria-labelledby=\{`connections-tab-\$\{key\}-\$\{base\}`\}/);
  assert.match(componentSource, /hidden=\{tab !== key\}/);
  assert.ok(componentSource.includes("فصل‌ها و آثار مرتبط"));
  assert.ok(componentSource.includes("انیمه‌های مشابه"));
  assert.equal(componentSource.includes('connection-tab-count'), false);
  assert.equal(componentSource.includes('connection-tab-icon'), false);
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) assert.ok(componentSource.includes(`"${key}"`), `${key} is handled`);
});

test("relation and format badges stay explicit and never turn films or OVAs into seasons", () => {
  assert.equal(connections.connectionRelationLabel({ relation: "PREQUEL", label: "x" }), "پیش‌درآمد");
  assert.equal(connections.connectionRelationLabel({ relation: "SEQUEL", label: "x" }), "ادامه");
  assert.equal(connections.connectionRelationLabel({ relation: "SIDE_STORY", label: "x" }), "داستان جانبی");
  assert.equal(connections.connectionRelationLabel({ relation: "SPIN_OFF", label: "x" }), "اسپین‌آف");
  assert.equal(connections.connectionRelationLabel({ relation: "CUSTOM", label: "پیوند ویژه" }), "پیوند ویژه");
  assert.equal(connections.connectionFormatLabel("MOVIE"), "فیلم");
  assert.equal(connections.connectionFormatLabel("OVA"), "OVA");
  assert.equal(connections.connectionFormatLabel("SPECIAL"), "ویژه");
  assert.equal(connections.connectionFormatLabel("TV"), "TV");
});

test("only canonical local anime pages can become destinations; artwork remains allowlisted", () => {
  assert.equal(connections.safeInternalHref("/anime/steins-gate"), true);
  assert.equal(connections.safeInternalHref("//evil.example/anime"), false);
  assert.equal(connections.safeInternalHref("https://anilist.co/anime/1"), false);
  assert.equal(connections.safeInternalHref("javascript:alert(1)"), false);
  assert.equal(connections.safeExternalHref("https://anilist.co/anime/9253"), true);
  assert.equal(connections.safeExternalHref("http://anilist.co/anime/9253"), false);
  assert.equal(connections.safeExternalHref("javascript:alert(1)"), false);
  assert.equal(connections.safeExternalHref("https://user:pass@anilist.co/anime/1"), false);
  for (const path of ['/login', '/anime/test?redirect=elsewhere', '/anime/../login', '/anime/%2e%2e', '/anime/a%2fb', '/anime/a\\b']) assert.equal(connections.safeInternalHref(path), false, path);
  assert.equal(connections.safeCoverSrc("/covers/enriched/steins-gate.webp"), "/covers/enriched/steins-gate.webp");
  assert.equal(connections.safeCoverSrc("https://s4.anilist.co/file/anilistcdn/media/anime/cover/b1.jpg"), "https://s4.anilist.co/file/anilistcdn/media/anime/cover/b1.jpg");
  assert.equal(connections.safeCoverSrc("https://tracker.example/pixel.gif"), null);
  assert.equal(connections.safeCoverSrc("javascript:alert(1)"), null);
});

test("only verified available cards with an exact local slug are displayed", () => {
  assert.match(componentSource, /<Link href=\{card\.href\}/);
  const card = { available: true, slug: 'example', href: '/anime/example' };
  assert.deepEqual(connections.localConnectionCards([card, { ...card, available: false }, { ...card, href: 'https://anilist.co/anime/1' }, { ...card, slug: undefined }, { ...card, href: '/anime/wrong-season' }]), [card]);
  assert.equal(componentSource.includes('<a '), false);
  assert.equal(componentSource.includes('target="_blank"'), false);
  assert.equal(/دانلود|download/i.test(componentSource), false, "recommendations never promise a download");
  assert.equal(componentSource.includes("dangerouslySetInnerHTML"), false);
});

test("cards keep measured poster ratio and concise local empty states", () => {
  assert.match(componentSource, /aspect-\[17\/24\]/);
  assert.ok(componentSource.includes('referrerPolicy="no-referrer"'));
  assert.ok(componentSource.includes("هم‌ژانر"));
  assert.ok(componentSource.includes("انیمهٔ مرتبطی در سایت موجود نیست"));
  assert.ok(componentSource.includes("motion-reduce:transition-none"));
  assert.ok(componentSource.includes("snap-x"));
  assert.ok(componentSource.includes("sm:grid-cols-2"));
  assert.ok(componentSource.includes("xl:grid-cols-3"));
  assert.equal(componentSource.includes("coverflow"), false);
});

test("section renders no marketing heading, description, source link or review date", () => {
  const data = { relations: [{ id: 'local', slug: 'local', href: '/anime/local', available: true, title: 'Local title', titleEn: 'Local title', year: 2020, format: 'TV', source: 'anilist', reason: 'AniList recommendation' }, { id: 'external', href: 'https://anilist.co/anime/1', available: false, title: 'External title' }], similar: [], sourceUrl: 'https://anilist.co/anime/2', checkedAt: '2026-10-30' };
  const html = require('react-dom/server').renderToStaticMarkup(connections.AnimeConnections({ connections: data }));
  for (const removed of ['نخ‌های داستان', 'مسیر و پیشنهاد', 'فصل‌های قبل و بعد، داستان‌های جانبی', 'آخرین بازبینی', 'AniList', 'anilist.co', 'External title', '<h2']) assert.equal(html.includes(removed), false, removed);
  assert.ok(html.includes('href="/anime/local"'));
  assert.ok(html.includes('aria-label="انیمه‌های مرتبط و مشابه"'));
});

test("premium tabs use only type and a subtle active line, not a raised control frame", () => {
  const light = read('src/app/light-theme.css');
  const css = read('src/app/globals.css');
  assert.equal(componentSource.includes('bg-amber-400 text-'), false);
  assert.ok(light.includes('html[data-theme="light"] .connection-tab[aria-selected="true"]'));
  assert.ok(light.includes('#795b2e'));
  const frame = css.match(/\.connections-tabs \{([^}]+)\}/)[1];
  const active = css.match(/\.connection-tab\[aria-selected="true"\] \{([^}]+)\}/)[1];
  assert.doesNotMatch(frame + active, /box-shadow|linear-gradient|border-radius/);
  assert.ok(css.includes('.connection-tab::after'));
  assert.ok(css.includes('.connection-tab:focus-visible'));
  assert.ok(css.includes('.connection-tab, .connection-tab::after { transition: none; }'));
});
