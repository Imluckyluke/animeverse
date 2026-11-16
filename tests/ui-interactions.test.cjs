const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// Run the small client utilities without installing a browser or test framework.
function load(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(
    (name) => dependencies[name] ?? require(name), module, module.exports,
  );
  return module.exports;
}

const { canShowAdmin } = load("src/lib/admin-visibility.ts");
test("only the requested Gmail shows the admin entry; server access is checked separately", () => {
  assert.equal(canShowAdmin(null), false);
  assert.equal(canShowAdmin({ email: "reader@example.com" }), false);
  assert.equal(canShowAdmin({ email: "Hadighgh84@gmail.com" }), true);
  assert.equal(canShowAdmin({ email: "  HADIGHGH84@GMAIL.COM  " }), true);
  assert.equal(canShowAdmin({ id: "other-owner", email: "owner@example.test", role: "owner" }), false);
  for (const role of ["editor", "reviewer"]) assert.equal(canShowAdmin({ id: "staff", email: "staff@example.test", role }), false);
  assert.equal(canShowAdmin({ email: "owner@example.test", role: "owner", localOnly: true }), false);
  assert.equal(canShowAdmin({ email: "reader@example.test", role: "user" }), false);
  assert.equal(canShowAdmin({ email: "hadighgh84@gmail.com.attacker.example" }), false);
});

function dragFixture() {
  const { useDragScroll } = load("src/lib/use-drag-scroll.ts", { react: { useRef: (current) => ({ current }) } });
  let capture = null;
  const el = {
    scrollLeft: 0, style: { scrollSnapType: "", cursor: "" },
    setPointerCapture: (id) => { capture = id; },
    hasPointerCapture: (id) => capture === id,
    releasePointerCapture: () => { capture = null; },
  };
  const handlers = useDragScroll({ current: el });
  const event = (overrides = {}) => ({
    type: "pointermove", pointerType: "mouse", button: 0, pointerId: 1, clientX: 100,
    target: { closest: () => null }, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
    ...overrides,
  });
  return { el, handlers, event };
}

test("ordinary link clicks and tiny pointer movements still navigate", () => {
  const { handlers, event } = dragFixture();
  handlers.onPointerDown(event());
  handlers.onPointerMove(event({ clientX: 103 }));
  handlers.onPointerUp(event({ type: "pointerup" }));
  const click = event({ detail: 1 });
  handlers.onClickCapture(click);
  assert.equal(click.prevented, false);
});

test("mouse dragging scrolls RTL tracks and suppresses only its accidental click", () => {
  const { el, handlers, event } = dragFixture();
  handlers.onPointerDown(event());
  handlers.onPointerMove(event({ clientX: 150 }));
  assert.equal(el.scrollLeft, -50);
  assert.equal(el.style.scrollSnapType, "none");
  handlers.onPointerUp(event({ type: "pointerup" }));
  assert.equal(el.style.scrollSnapType, "");
  const click = event({ detail: 1 });
  handlers.onClickCapture(click);
  assert.equal(click.prevented, true);
  assert.equal(click.stopped, true);
  const next = event({ detail: 1 });
  handlers.onClickCapture(next);
  assert.equal(next.prevented, false);
});

test("touch gestures and buttons are left to their native controls", () => {
  for (const overrides of [{ pointerType: "touch" }, { target: { closest: () => ({}) } }]) {
    const { el, handlers, event } = dragFixture();
    handlers.onPointerDown(event(overrides));
    handlers.onPointerMove(event({ clientX: 150 }));
    assert.equal(el.scrollLeft, 0);
  }
});

test("cancel restores snapping; a keyboard click is never swallowed", () => {
  const { el, handlers, event } = dragFixture();
  handlers.onPointerDown(event());
  handlers.onPointerMove(event({ clientX: 150 }));
  handlers.onPointerCancel(event({ type: "pointercancel" }));
  assert.equal(el.style.scrollSnapType, "");
  const click = event({ detail: 0 });
  handlers.onClickCapture(click);
  assert.equal(click.prevented, false);
});

test("overlapping dialogs preserve the original body scroll style", () => {
  const original = global.document;
  global.document = { body: { style: { overflow: "clip" } } };
  try {
    const { lockPageScroll } = load("src/lib/scroll-lock.ts");
    const first = lockPageScroll();
    const second = lockPageScroll();
    assert.equal(document.body.style.overflow, "hidden");
    first();
    first(); // Release is idempotent.
    assert.equal(document.body.style.overflow, "hidden");
    second();
    assert.equal(document.body.style.overflow, "clip");
  } finally { global.document = original; }
});

const { synopsisLayout } = load("src/lib/synopsis-layout.ts");
test("synopsis toggle follows actual overflow, not text length", () => {
  assert.deepEqual(synopsisLayout(28, 28, true), { full: 28, collapsed: 28, expandable: false });
  assert.equal(synopsisLayout(84, 28, true).expandable, false);
  assert.equal(synopsisLayout(84.5, 28, true).expandable, false);
  assert.deepEqual(synopsisLayout(168, 28, true), { full: 168, collapsed: 84, expandable: true });
  assert.deepEqual(synopsisLayout(168, 28, false), { full: 168, collapsed: 168, expandable: false });
});

test("a short synopsis renders once, without an unconditional more/close button", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { ExpandableSynopsis } = load("src/components/anime/expandable-synopsis.tsx", {
    "@/lib/synopsis-layout": { synopsisLayout },
  });
  const html = renderToStaticMarkup(React.createElement(ExpandableSynopsis, { text: "داستان" }));
  assert.equal((html.match(/داستان/g) ?? []).length, 1);
  assert.equal(html.includes("<button"), false);
});

test("static component CSS is not HTML-escaped inside SSR style raw text", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  for (const relative of ["src/components/ui/halftone-wordmark-footer.tsx", "src/components/ui/glass-folder-cards.tsx"]) {
    const Component = load(relative).default;
    const html = renderToStaticMarkup(React.createElement(Component, { appear: false, art: "none" }));
    const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]);
    assert.ok(styles.length > 0, relative);
    for (const css of styles) {
      assert.equal(css.includes("&quot;"), false, relative);
      assert.equal(css.includes("&#x27;"), false, relative);
    }
  }
});

test("the primary hero cover stays sharp while its separate atmosphere stays soft", () => {
  const css = fs.readFileSync(path.join(__dirname, "../src/app/globals.css"), "utf8");
  const front = css.match(/\.hero-front-art\s*\{([^}]+)\}/)[1];
  assert.equal(/filter\s*:\s*blur/.test(front), false);
  const hero = fs.readFileSync(path.join(__dirname, "../src/components/home/hero.tsx"), "utf8");
  const artwork = fs.readFileSync(path.join(__dirname, "../src/components/ui/hero-artwork.tsx"), "utf8");
  assert.ok(hero.includes("<HeroArtwork"));
  assert.ok(artwork.includes('fit="cover"'));
  assert.equal(artwork.includes('fit="scale-down"'), false);
  assert.match(front, /scale\(1\.055\)/);
  assert.match(css, /backdrop-filter: blur\(1\.5px\)/);
  assert.match(css, /aspect-ratio: var\(--hero-banner-ratio\)/);
});

function navigationFixture() {
  const callbacks = new Map();
  const listeners = new Map();
  let nextId = 1;
  const history = { state: { __NA: true, routerTree: { keep: true } }, scrollRestoration: "auto",
    replaceState(state) { this.state = state; } };
  const location = { pathname: "/browse", search: "?sort=alpha", hash: "", origin: "https://example.test" };
  const docListeners = new Map();
  const document = { documentElement: { scrollHeight: 5000 }, body: {},
    addEventListener: (name, callback) => docListeners.set(name, callback),
    removeEventListener: (name) => docListeners.delete(name) };
  const win = { history, location, document, scrollX: 0, scrollY: 0, innerHeight: 800, calls: [],
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
    requestAnimationFrame: (callback) => { const id = nextId++; callbacks.set(id, callback); return id; },
    cancelAnimationFrame: (id) => callbacks.delete(id),
    setTimeout: (callback) => { const id = nextId++; callbacks.set(id, callback); return id; },
    clearTimeout: (id) => callbacks.delete(id),
    scrollTo(point) { this.calls.push(point); this.scrollX = point.left; this.scrollY = point.top; } };
  const utility = load("src/lib/navigation-scroll.ts");
  const controller = utility.installScrollRestoration(win);
  const emit = (name, event = {}) => listeners.get(name)?.(event);
  const flush = () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback()); };
  const save = (y) => { win.scrollY = y; emit("scroll"); flush(); return structuredClone(history.state); };
  return { win, utility, controller, emit, flush, save, callbacks, listeners, docListeners };
}

test("scroll and expanded results preserve Next state, remain per-entry, and respect result identity", () => {
  const f = navigationFixture();
  f.save(2200);
  f.utility.rememberCatalogPage(f.win, "filter-A", 90);
  assert.deepEqual(f.win.history.state.routerTree, { keep: true });
  assert.equal(f.win.history.state.__NA, true);
  assert.equal(f.win.history.state.__avNavigation.scroll.y, 2200);
  assert.equal(f.utility.readCatalogPage(f.win, "filter-A", 200), 90);
  assert.equal(f.utility.readCatalogPage(f.win, "filter-A", 45), 45);
  assert.equal(f.utility.readCatalogPage(f.win, "filter-B", 200), 30);
  f.win.history.state = { __NA: true };
  assert.equal(f.utility.readCatalogPage(f.win, "filter-A", 200), 30);
  f.controller.dispose();
  assert.equal(f.win.history.scrollRestoration, "auto");
  assert.equal(f.listeners.size, 0);
  assert.equal(f.docListeners.size, 0);
});

test("back waits for the committed long page instead of clamping to a short loading screen", () => {
  const f = navigationFixture();
  const browse = f.save(2200);
  f.win.location.pathname = "/anime/example";
  f.win.location.search = "";
  f.win.history.state = { __NA: true };
  f.win.scrollY = 0;
  f.controller.commit("/anime/example?");
  assert.equal(f.win.calls.length, 0, "Fresh detail navigation is not restored to the list's position");
  f.win.location.pathname = "/browse";
  f.win.location.search = "?sort=alpha";
  f.win.history.state = browse;
  f.win.document.documentElement.scrollHeight = 1000;
  f.emit("popstate");
  f.emit("scroll");
  assert.equal(f.win.history.state.__avNavigation.scroll.y, 2200);
  f.controller.commit("/browse?sort=alpha");
  // Execute just the animation frame; the final fallback is separate.
  const frame = [...f.callbacks.entries()].at(-1);
  f.callbacks.delete(frame[0]); frame[1]();
  assert.equal(f.win.calls.length, 0);
  f.win.document.documentElement.scrollHeight = 5000;
  f.flush();
  assert.equal(f.win.scrollY, 2200);
  assert.equal(f.win.calls[0].behavior, "instant");
  f.controller.dispose();
});

test("a user's touch cancels a delayed restore, and hash targets keep native navigation", () => {
  for (const cancel of ["touchstart", "wheel", "pointerdown", "keydown"]) {
    const f = navigationFixture();
    const state = f.save(2200);
    f.win.history.state = state;
    f.win.document.documentElement.scrollHeight = 1000;
    f.emit("popstate");
    f.emit(cancel);
    f.win.document.documentElement.scrollHeight = 5000;
    f.flush();
    assert.equal(f.win.calls.length, 0, cancel);
    f.controller.dispose();
  }
  const f = navigationFixture();
  f.win.location.hash = "#episodes";
  f.save(1200);
  f.emit("popstate");
  f.flush();
  assert.equal(f.win.calls.length, 0);
  f.controller.dispose();
});

test("restricted history falls back without breaking navigation or using account/local storage", () => {
  const f = navigationFixture();
  f.win.history.replaceState = () => { throw new Error("History blocked"); };
  assert.doesNotThrow(() => f.save(1500));
  assert.equal(f.win.history.scrollRestoration, "auto");
  assert.doesNotThrow(() => f.utility.rememberCatalogPage(f.win, "filter", 60));
  f.controller.dispose();
});

test("filter URL updates retain checkpoints without bypassing Next's native History integration", () => {
  const f = navigationFixture();
  f.save(1800);
  f.utility.rememberCatalogPage(f.win, "filter-A", 90);
  let nextUrl;
  f.win.history.replaceState = function (data, _unused, url) {
    assert.equal(data.__NA, undefined, "The internal router flag would bypass search-param synchronization");
    nextUrl = url;
    this.state = { ...data, __NA: true, routerTree: this.state.routerTree };
  };
  f.utility.replaceNavigationUrl(f.win, "/browse?genre=action#main");
  assert.equal(nextUrl, "/browse?genre=action#main");
  assert.equal(f.win.history.state.__NA, true);
  assert.equal(f.utility.readCatalogPage(f.win, "filter-A", 200), 90);
  assert.equal(f.win.history.state.__avNavigation.scroll.y, 1800);
  // Cleanup normally writes no new URL, unlike this narrow integration stub.
  f.win.history.replaceState = function (state) { this.state = state; };
  f.controller.dispose();
});
