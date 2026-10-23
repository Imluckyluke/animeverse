const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// Run the small client utilities without installing a browser or test framework.
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

const { canShowAdmin } = load("src/lib/admin-visibility.ts");
test("only the owner email shows admin UI (not server authorization)", () => {
  assert.equal(canShowAdmin(null), false);
  assert.equal(canShowAdmin({ email: "reader@example.com" }), false);
  assert.equal(canShowAdmin({ email: "Hadighgh84@gmail.com" }), true);
  assert.equal(canShowAdmin({ email: "  HADIGHGH84@GMAIL.COM  " }), true);
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
