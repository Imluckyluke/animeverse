const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function load(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)((name) => dependencies[name] ?? require(name), module, module.exports);
  return module.exports;
}
const skeleton = load("src/components/ui/skeleton.tsx", { "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") } });
const previews = load("src/components/loading-previews.tsx", { "@/components/ui/skeleton": skeleton });
const render = (name) => renderToStaticMarkup(React.createElement(previews[name]));

test("all route previews announce loading and hide decorative placeholders", () => {
  for (const name of ["HomeLoadingPreview", "ArchiveLoadingPreview", "LibraryLoadingPreview", "DetailLoadingPreview", "LibraryStoragePreview", "AuthLoadingPreview", "AdminLoadingPreview", "DocumentLoadingPreview"]) {
    const html = render(name);
    assert.match(html, /role="status"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /aria-label="[^"]+"/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /dir="rtl"/);
    assert.doesNotMatch(html, /<(button|input|a|img|header|footer)\b/);
  }
});

test("search and browse share the archive preview; every route uses its matched export", () => {
  const routes = { "loading.tsx": "HomeLoadingPreview", "browse/loading.tsx": "ArchiveLoadingPreview", "search/loading.tsx": "ArchiveLoadingPreview", "favorites/loading.tsx": "LibraryLoadingPreview", "anime/[slug]/loading.tsx": "DetailLoadingPreview", "login/loading.tsx": "AuthLoadingPreview", "join/loading.tsx": "ArchiveLoadingPreview", "admin/loading.tsx": "AdminLoadingPreview", "privacy/loading.tsx": "DocumentLoadingPreview", "terms/loading.tsx": "DocumentLoadingPreview" };
  for (const [route, name] of Object.entries(routes)) {
    const component = load(`src/app/${route}`, { "@/components/loading-previews": previews }).default;
    assert.equal(renderToStaticMarkup(React.createElement(component)), render(name));
  }
});

test("library storage preview is one subtle panel, not invented folders or posters", () => {
  const html = render("LibraryStoragePreview");
  assert.equal((html.match(/class="skeleton /g) ?? []).length, 3);
  assert.doesNotMatch(html, /aspect-|grid-cols|390px|folder/i);
  assert.match(html, /backdrop-blur-\[6px\]/);
});

test("home has compact episode rows before discovery; detail retains mobile poster and timeline", () => {
  const home = render("HomeLoadingPreview");
  assert.ok(home.indexOf("xl:grid-cols-3") < home.indexOf("w-[42vw]"));
  assert.match(home, /min-h-\[min\(680px,76svh\)\]/);
  const detail = render("DetailLoadingPreview");
  assert.match(detail, /order-first/);
  assert.match(detail, /aspect-\[17\/24\]/);
  assert.match(detail, /divide-y/);
  assert.match(detail, /min-w-0 flex-1/);
});

test("previews use existing reduced-motion skeletons without timers or animated blur", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/components/loading-previews.tsx"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../src/app/globals.css"), "utf8");
  assert.doesNotMatch(source, /setTimeout|setInterval|animate-|framer-motion|useEffect/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(source, /import \{ Skeleton \}/);
});
