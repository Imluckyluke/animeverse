const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");

test("social preview is a static PNG with correct large-card dimensions", () => {
  const png = fs.readFileSync(path.join(root, "src/app/opengraph-image.png"));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length < 500_000, "Keep the Telegram preview lightweight");
  assert.ok(!fs.existsSync(path.join(root, "src/app/opengraph-image.tsx")), "No competing RTL image renderer");
  assert.match(fs.readFileSync(path.join(root, "src/app/opengraph-image.alt.txt"), "utf8"), /انیمه‌ورس/);
});

test("generator uses real Persian font shaping and RTL before rasterizing", () => {
  const source = fs.readFileSync(path.join(root, "scripts/generate-social-card.cjs"), "utf8");
  assert.match(source, /lang="fa" dir="rtl"/);
  assert.match(source, /Vazirmatn\.woff2/);
  assert.match(source, /document\.fonts\.ready/);
  assert.match(source, /آرشیو انیمه با زیرنویس فارسی/);
  assert.doesNotMatch(source, /ImageResponse/);
});
