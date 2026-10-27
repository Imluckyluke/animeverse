const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/components/ui/hero-artwork.tsx"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const moduleObject = { exports: {} };
new Function("require", "module", "exports", js)(name => ({
  "@/lib/images": { artworkFor: () => undefined },
  "@/lib/artwork-overrides": { COVER_VARIANTS: {} },
  "@/components/ui/cover-image": { CoverImage: ({ src, fit, zoom }) => React.createElement("img", { src, "data-fit": fit, "data-zoom": String(zoom) }) },
}[name] ?? require(name)), moduleObject, moduleObject.exports);
const render = anime => renderToStaticMarkup(React.createElement(moduleObject.exports.HeroArtwork, { anime: { slug: "test", ...anime } }));

test("real wide banners keep their own frame while mobile uses a portrait", () => {
  const html = render({ cover: "/portrait.webp", coverAspectRatio: 0.7, banner: "/banner.webp", bannerAspectRatio: 4.75 });
  assert.ok(html.includes('data-hero-art="portrait"'));
  assert.ok(html.includes('data-hero-art="banner"'));
  assert.ok(html.includes('--hero-banner-ratio:4.75'));
  assert.ok(html.includes('data-fit="cover"'));
});

test("a duplicated portrait is not treated as a native banner", () => {
  const html = render({ cover: "/portrait.webp", banner: "/portrait.webp", bannerAspectRatio: 0.7 });
  assert.equal(html.includes('data-hero-art="banner"'), false);
  assert.equal(html.includes('scale-down'), false);
});

test("landscape covers are not forced into a narrow portrait crop", () => {
  const html = render({ cover: "/landscape.webp", coverAspectRatio: 1.8 });
  assert.ok(html.includes('hero-front-art--landscape'));
  assert.ok(html.includes('--hero-front-ratio:1.8'));
});

test("image dimensions stay on the server instead of entering the client bundle", () => {
  const files = ["src/components/ui/hero-artwork.tsx", "src/lib/catalog.ts", "src/lib/artwork-overrides.ts"];
  for (const file of files) assert.equal(fs.readFileSync(path.join(__dirname, "..", file), "utf8").includes('artwork-dimensions.json'), false);
  assert.ok(fs.readFileSync(path.join(__dirname, "../src/lib/data.ts"), "utf8").includes('artwork-dimensions.json'));
});
