const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

test("touch and mouse drags advance right and go back left in the RTL hero", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/components/home/hero.tsx"), "utf8");
  const ast = ts.createSourceFile("hero.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const directions = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "go" && node.arguments[0]?.getText(ast).includes("dx")) {
      directions.push(new Function("dx", `return (${node.arguments[0].getText(ast)})`));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(directions.length, 2, "Both touch and mouse must share the RTL direction");
  for (const direction of directions) {
    assert.equal(direction(100), 1);
    assert.equal(direction(-100), -1);
  }
  assert.ok(source.includes("Math.abs(dx) < 44"), "Keep the accidental-touch threshold");
  assert.ok(source.includes('event.type === "pointercancel"'), "Cancelled drags must not navigate");
});
