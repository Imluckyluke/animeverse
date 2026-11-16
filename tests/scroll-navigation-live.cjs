/* Public, read-only browser regression: no accounts, credentials or downloads. */
const assert = require("node:assert/strict");
const { chromium } = require(process.env.AV_PLAYWRIGHT_MODULE || "/var/lib/bot-host/.npm/_npx/f0a362733743bae2/node_modules/playwright");
const base = process.env.AV_SCROLL_TEST_BASE || "http://127.0.0.1:3107";

(async () => {
  const browser = await chromium.launch({
    executablePath: "/var/lib/bot-host/.cache/visual-qa/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: "/tmp/opencode", LD_LIBRARY_PATH: process.env.AV_BROWSER_LIBRARY_PATH || "/var/lib/bot-host/.cache/visual-qa/sysroot/usr/lib/x86_64-linux-gnu" },
  });
  let diagnosticPage;
  try {
    const widths = process.env.AV_SCROLL_TEST_WIDTHS ? process.env.AV_SCROLL_TEST_WIDTHS.split(",").map(Number) : [390, 1440];
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: width === 390 ? "reduce" : "no-preference", serviceWorkers: "block" });
      const page = await context.newPage();
      diagnosticPage = page;
      page.setDefaultTimeout(45000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const listing = "/browse?sort=alpha&genre=" + encodeURIComponent("اکشن");
      await page.goto(base + listing, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.locator('[data-catalog-ready="true"]').waitFor();
      const cards = page.locator("main article");
      assert.equal(await cards.count(), 30);
      const more = page.getByRole("button", { name: /^نمایش .* عنوان دیگر$/ });
      for (const count of [60, 90]) {
        await more.click();
        await page.waitForFunction(count => document.querySelectorAll("main article").length === count, count);
      }
      const first = await cards.first().locator("a").first().getAttribute("href");
      const card = cards.nth(72).locator("a").first();
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(80);
      const box = await card.boundingBox();
      assert.ok(box);
      const y = await page.evaluate(() => scrollY);
      const url = page.url();
      assert.ok(y > 1000);
      console.log("SCROLL_TEST_PHASE", width, "expanded-list", y);
      // A real pointer click at the current position: Playwright's locator.click
      // may scroll the card again underneath the sticky header, changing the
      // list position being verified.
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForURL("**/anime/**", { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page.waitForFunction(() => scrollY < 150);
      console.log("SCROLL_TEST_PHASE", width, "detail-top");
      await page.evaluate(() => scrollTo({ top: 450, behavior: "instant" }));
      await page.waitForFunction(() => scrollY >= 400);
      await page.waitForFunction(() => (window.history.state?.__avNavigation?.scroll?.y ?? -1) >= 400);
      const detailY = await page.evaluate(() => window.history.state.__avNavigation.scroll.y);
      await page.goBack({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(y => Math.abs(scrollY - y) <= 3 && document.querySelectorAll("main article").length === 90, y);
      assert.equal(page.url(), url, "Search/filter URL must survive Back");
      assert.equal(await cards.first().locator("a").first().getAttribute("href"), first);
      console.log("SCROLL_TEST_PHASE", width, "back-restored");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(y => Math.abs(scrollY - y) <= 3 && document.querySelectorAll("main article").length === 90, y);
      assert.equal(page.url(), url, "Reload must retain the same list entry and filters");
      console.log("SCROLL_TEST_PHASE", width, "reload-restored");
      await page.goForward({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(y => Math.abs(scrollY - y) <= 3, detailY);
      console.log("SCROLL_TEST_PHASE", width, "forward-restored");
      await page.locator('a[href="/browse"]:visible').first().click();
      await page.waitForURL("**/browse", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => scrollY < 150 && document.querySelectorAll("main article").length === 30);

      // The same guarantee applies outside the archive, including the home feed.
      await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
      const homeCard = page.locator('main a[href^="/anime/"]').nth(12);
      await homeCard.scrollIntoViewIfNeeded();
      const homeY = await page.evaluate(() => scrollY);
      await page.waitForFunction(y => window.history.state?.__avNavigation?.scroll?.y === y, homeY);
      // The coverflow rail's 3D transforms can sit above the link for Playwright's
      // hit-test even though the card is visible; dispatch the same click event a
      // pointer produces so this test measures scroll coordination, not carousel
      // hit-testing (real archive cards above use a normal pointer click).
      await homeCard.evaluate(element => element.click());
      await page.waitForURL("**/anime/**", { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page.goBack({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(y => Math.abs(scrollY - y) <= 3, homeY);
      assert.deepEqual(errors, [], "No client runtime exceptions");
      console.log("SCROLL_NAVIGATION_BROWSER_OK", JSON.stringify({ width, archiveY: y, restoredCards: 90, homeY }));
      await context.close();
    }
  } finally {
    if (diagnosticPage && !diagnosticPage.isClosed()) {
      console.log("SCROLL_BROWSER_DIAGNOSTIC", await diagnosticPage.evaluate(() => ({
        path: location.pathname + location.search, y: scrollY, height: document.documentElement.scrollHeight,
        checkpoint: history.state?.__avNavigation, cards: document.querySelectorAll("main article").length,
      })).catch(() => ({ unavailable: true })));
    }
    await browser.close();
  }
})().catch(error => { console.error("SCROLL_NAVIGATION_BROWSER_FAILED", error.message); process.exitCode = 1; });
