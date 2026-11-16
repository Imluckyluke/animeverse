const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

// Load the real components with tiny dependency doubles for context and the
// visual footer primitive. This exercises the layout-owned footer wiring and
// the guest/user column filtering without a browser.
function load(relative, dependencies = {}) {
  const source = read(relative);
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(
    name => dependencies[name] ?? require(name), module, module.exports,
  );
  return module.exports;
}

const SITE = {
  name: "انیمه‌ورس",
  tagline: "جهانی برای دیدن و دانلود انیمه",
  telegram: "https://t.me/testanivers",
};

function siteFooter() {
  const { SiteFooter } = load("src/components/site-footer.tsx", {
    "@/lib/data": { SITE },
    "@/components/account-footer": { AccountFooter: () => null },
  });
  // jsx() creates the child element without invoking it, so read the props
  // that SiteFooter actually handed to AccountFooter.
  const tree = SiteFooter();
  assert.ok(tree?.props?.children?.props, "SiteFooter should render AccountFooter");
  return tree.props.children.props;
}

function accountColumns(user, columns) {
  const { AccountFooter } = load("src/components/account-footer.tsx", {
    "@/components/ui/halftone-wordmark-footer": () => null,
    "@/lib/app-context": { useApp: () => ({ user }) },
  });
  const tree = AccountFooter({ columns });
  assert.ok(tree?.props?.columns, "AccountFooter should pass filtered columns through");
  return tree.props.columns;
}

const hrefs = columns => columns.flatMap(column => column.links.map(link => link.href));

test("layout footer keeps its identity, essential legal/account links and a compact mobile band", () => {
  const props = siteFooter();
  assert.equal(props.label, SITE.name);
  assert.match(props.meta, new RegExp(SITE.name));
  assert.equal(props.columns.length, 3);
  assert.deepEqual(props.columns.map(column => column.title), ["بخش‌ها", "کتابخانه", "ارتباط"]);

  for (const href of ["/", "/browse", "/favorites", "/login", "/privacy", "/terms"]) {
    assert.ok(hrefs(props.columns).includes(href), `missing ${href}`);
  }
  assert.ok(props.columns.flatMap(column => column.links).some(link => link.href === SITE.telegram));
  assert.equal(props.backToTopLabel, "بازگشت به بالا ↑");

  // The empty wordmark band is breathing room, not content: let it shrink on
  // phones while 10vw keeps the desktop size exactly as before.
  assert.equal(props.band, "max(36px, min(10vw, 110px))");
  const source = read("src/components/site-footer.tsx");
  assert.match(source, /mt-4[^"]*md:mt-8/);
  assert.match(source, /pb-\[calc\(env\(safe-area-inset-bottom,0px\)\+5\.5rem\)\]/);
  assert.match(source, /md:pb-0/);
});

test("guest footer keeps login + legal links, removes favorites and labels the account column", () => {
  const columns = accountColumns(null, siteFooter().columns);
  assert.deepEqual(columns.map(column => column.title), ["بخش‌ها", "حساب", "ارتباط"]);

  const outbound = hrefs(columns);
  assert.equal(outbound.includes("/favorites"), false);
  for (const href of ["/login", "/privacy", "/terms"]) assert.ok(outbound.includes(href), href);
  assert.equal(columns.flatMap(column => column.links).find(link => link.href === "/privacy")?.label, "حریم خصوصی");
});

test("signed-in footer restores the library column without removing legal links", () => {
  const columns = accountColumns({ id: "reader" }, siteFooter().columns);
  assert.deepEqual(columns.map(column => column.title), ["بخش‌ها", "کتابخانه", "ارتباط"]);
  for (const href of ["/favorites", "/login", "/privacy", "/terms"]) {
    assert.ok(hrefs(columns).includes(href), href);
  }
});

test("mobile footer keeps a full-width brand, spacious two-column navigation and single-column links", () => {
  const css = read("src/components/ui/halftone-wordmark-footer.tsx");
  const mobileStart = css.indexOf("@media (max-width: 720px)");
  const reducedStart = css.indexOf("@media (prefers-reduced-motion", mobileStart);
  assert.ok(mobileStart > 0 && reducedStart > mobileStart, "mobile and reduced-motion blocks should exist");

  const mobile = css.slice(mobileStart, reducedStart);
  assert.match(mobile, /\.hwf-top\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mobile, /\.hwf-top\s*\{[^}]*row-gap:\s*18px/);
  assert.match(mobile, /\.hwf-top\s*\{[^}]*padding:\s*20px 20px 0/);
  assert.match(mobile, /\.hwf-top\s*\{[^}]*line-height:\s*1\.75/);
  assert.match(mobile, /\.hwf-brand\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(mobile, /\.hwf-col ul\s*\{\s*display:\s*block/);
  assert.doesNotMatch(mobile, /\.hwf-col ul\s*\{[^}]*grid-template-columns/);
  assert.match(mobile, /\.hwf-col:last-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(mobile, /\.hwf-col:last-child ul\s*\{[^}]*display:\s*flex/);
  assert.match(mobile, /\.hwf-col a,\s*\.hwf-up\s*\{[^}]*min-height:\s*40px/);
  assert.doesNotMatch(mobile, /overflow-wrap:\s*anywhere/);
  assert.match(mobile, /\.hwf-rule\s*\{[^}]*margin:\s*14px 20px 0/);

  // Compact means tightened rhythm, not hidden content.
  assert.doesNotMatch(mobile, /display:\s*none|visibility:\s*hidden|content-visibility:\s*hidden/);
});

test("desktop footer geometry and reduced-motion handling stay unchanged", () => {
  const css = read("src/components/ui/halftone-wordmark-footer.tsx");
  const mobileStart = css.indexOf("@media (max-width: 720px)");
  const desktop = css.slice(0, mobileStart);

  assert.match(
    desktop,
    /\.hwf-top\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.25fr\)\s+repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(desktop, /\.hwf-top\s*\{[^}]*padding:\s*clamp\(24px,\s*3\.6vw,\s*42px\)\s+clamp\(20px,\s*3\.4vw,\s*44px\)\s+0/);
  assert.match(desktop, /min-height:\s*44px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.hwf-col a,\s*\.hwf-up\s*\{\s*transition:\s*none;/);
});
