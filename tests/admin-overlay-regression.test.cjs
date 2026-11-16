const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const adminDir = path.join(root, "src/components/admin");

function load(relative) {
  const source = read(relative);
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(require, module, module.exports);
  return module.exports;
}

const ui = read("src/components/admin/console-ui.tsx");
const dock = read("src/components/mobile-nav.tsx");
const adminConsole = read("src/components/admin/admin-console.tsx");

test("admin dialogs portal to the document body to escape the page stacking context", () => {
  // <main> is a z-10 stacking context and the mobile dock is its z-75 sibling,
  // so a fixed dialog rendered inside the console can never clear the dock.
  assert.match(ui, /import \{ createPortal \} from "react-dom";/);
  assert.match(ui, /return createPortal\(/);
  assert.match(ui, /createPortal\([\s\S]*?document\.body,/);
  assert.match(ui, /const \[mounted, setMounted\] = useState\(false\)/);
  assert.match(ui, /if \(!open \|\| !mounted\) return null/);
  assert.match(ui, /data-console-overlay=""/);
});

test("the shared dialog layer clears the dock, header and admin notices", () => {
  const dialogZ = Number(ui.match(/fixed inset-0 z-\[(\d+)\] flex items-end/)?.[1]);
  const dockZ = Number(dock.match(/fixed inset-x-3 z-\[(\d+)\]/)?.[1]);
  const noticeZ = Number(adminConsole.match(/fixed inset-x-0 bottom-4 z-\[(\d+)\]/)?.[1]);
  assert.ok(Number.isFinite(dialogZ), "dialog layer must declare a z-index");
  assert.ok(Number.isFinite(dockZ), "mobile dock layer must declare a z-index");
  assert.ok(Number.isFinite(noticeZ), "notice layer must declare a z-index");
  assert.ok(dialogZ > dockZ, "dialog layer must paint above the mobile dock");
  assert.ok(dialogZ > noticeZ, "dialog layer must paint above console notices");
});

test("every admin dialog goes through the one shared overlay", () => {
  const menuFiles = fs.readdirSync(adminDir).filter((file) => file.endsWith(".tsx"));
  for (const file of menuFiles) {
    if (file === "console-ui.tsx") continue;
    const source = fs.readFileSync(path.join(adminDir, file), "utf8");
    assert.doesNotMatch(
      source,
      /role="dialog"/,
      `${file} must use ConsoleDialog/ConfirmDialog instead of a bespoke dialog overlay`,
    );
  }
  assert.match(ui, /role="dialog"/);
  assert.match(ui, /aria-modal="true"/);
});

test("nested dialogs keep only the top layer on Escape and Tab", () => {
  const { pushOverlay, isTopOverlay } = load("src/lib/overlay-stack.ts");
  const first = Symbol("first");
  const second = Symbol("second");

  const releaseFirst = pushOverlay(first);
  assert.equal(isTopOverlay(first), true);
  const releaseSecond = pushOverlay(second);
  assert.equal(isTopOverlay(first), false);
  assert.equal(isTopOverlay(second), true);

  releaseFirst(); // A lower dialog unmounting must not release the top one.
  assert.equal(isTopOverlay(second), true);
  releaseSecond();
  assert.equal(isTopOverlay(second), false);

  releaseSecond(); // Cleanup is idempotent during route changes/unmounts.
  assert.equal(isTopOverlay(second), false);

  assert.match(ui, /if \(!isTopOverlay\(token\)\) return/);
  assert.match(ui, /event\.key === "Escape"/);
  assert.match(ui, /event\.key !== "Tab"/);
});

test("dialog scroll lock releases on cleanup and restores the opener", () => {
  const original = global.document;
  global.document = { body: { style: { overflow: "auto" } } };
  try {
    const { lockPageScroll } = load("src/lib/scroll-lock.ts");
    const first = lockPageScroll();
    const second = lockPageScroll();
    assert.equal(document.body.style.overflow, "hidden");
    first();
    assert.equal(document.body.style.overflow, "hidden");
    second();
    assert.equal(document.body.style.overflow, "auto");
  } finally {
    global.document = original;
  }

  assert.match(ui, /const unlock = lockPageScroll\(\)/);
  assert.match(ui, /releaseOverlay\(\);/);
  assert.match(ui, /unlock\(\);/);
  assert.match(ui, /if \(opener\?\.isConnected\) opener\.focus\(\{ preventScroll: true \}\)/);
  assert.match(ui, /aria-describedby=\{description \? descriptionId : undefined\}/);
});

test("bottom sheets stay scrollable, above safe areas and reduced-motion aware", () => {
  assert.match(ui, /max-h-\[92dvh\]/);
  assert.match(ui, /overflow-y-auto overscroll-contain/);
  assert.match(ui, /env\(safe-area-inset-bottom\)/);
  assert.match(ui, /prefers-reduced-motion: reduce/);
});
