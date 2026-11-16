// Content-only publication gate; no file transfers, accounts or cache jobs.
const assert = require('node:assert/strict');
const { chromium } = require('/var/lib/bot-host/.npm/_npx/f0a362733743bae2/node_modules/playwright');

(async () => {
  const base = process.env.AV_ACCOUNT_TEST_BASE;
  assert(base && /^https:\/\/animeverse-[a-z0-9-]+\.vercel\.app$/.test(base));
  const browser = await chromium.launch({
    executablePath: '/var/lib/bot-host/.cache/visual-qa/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: '/tmp/opencode', LD_LIBRARY_PATH: '/tmp/opencode/animeverse-admin-browser-libs/lib' },
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(25000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(base + '/anime/link-click-season-3', { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    await page.getByRole('heading', { level: 1, name: 'Link Click Season 3 Part 1', exact: true }).waitFor();
    await page.getByText('لینک کلیک — فصل ۳، بخش ۱', { exact: true }).first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false);
    const duplicate = await page.request.get(base + '/anime/shiguang-dailiren-iii');
    assert.equal(duplicate.status(), 404);
    assert.deepEqual(errors, []);
    console.log('LINK_CLICK_CORRECT_PART_MOBILE_PAGE_DUPLICATE_HIDDEN_NO_TRANSFER_TEST_OK');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
