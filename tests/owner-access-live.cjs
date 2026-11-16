const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('/var/lib/bot-host/.npm/_npx/f0a362733743bae2/node_modules/playwright');
let sensitive = '';
(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8')); sensitive = input.token;
  const browser = await chromium.launch({ executablePath: '/var/lib/bot-host/.cache/visual-qa/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--no-sandbox'], env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: '/tmp/opencode', LD_LIBRARY_PATH: '/tmp/opencode/animeverse-admin-browser-libs/lib' } });
  try {
    const context = await browser.newContext();
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    await page.goto(input.base + '/account/access#token=' + input.token, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(input.base + '/admin');
    await page.getByRole('heading', { name: 'نمای کلی', exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, '');
    const account = await (await context.request.get(input.base + '/api/account/session')).json();
    assert.equal(account.user.role, 'owner');
    const cookies = await context.cookies();
    assert.ok(cookies.some(cookie => cookie.name.endsWith('av_account_session') && cookie.httpOnly && cookie.secure));
    const replay = await context.request.post(input.base + '/api/account/access', { headers: { Origin: input.base }, data: { token: input.token } });
    assert.equal(replay.status(), 403);
    const footer = page.getByRole('link', { name: 'تلگرام', exact: true });
    assert.equal(await footer.getAttribute('href'), 'https://t.me/ImLuckyluke');
    const catalog = await (await context.request.get(input.base + '/api/catalog-search')).json();
    const hydrated = page.waitForResponse(response => response.url().includes('/api/account/session') && response.request().method() === 'GET');
    await page.goto(input.base + '/anime/' + catalog[0].slug, { waitUntil: 'domcontentloaded' });
    await hydrated;
    await page.getByRole('button', { name: 'دانلود همهٔ قسمت‌ها', exact: true }).click();
    const picker = page.getByRole('combobox', { name: 'کیفیت قسمت‌ها', exact: true });
    await picker.click();
    assert.equal(await page.locator('select#download-bulk-quality').count(), 0);
    await page.getByRole('option').first().click();
    assert.equal(await picker.getAttribute('aria-expanded'), 'false');
    const logout = await context.request.delete(input.base + '/api/account/session', { headers: { Origin: input.base, 'X-CSRF-Token': account.csrf } });
    assert.equal(logout.status(), 200);
    assert.equal((await context.request.get(input.base + '/api/admin/session')).status(), 404);
    console.log('OWNER_ACCESS_ONE_USE_COOKIE_PANEL_FOOTER_VERIFIED');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => {
  const message = sensitive ? String(error.message).split(sensitive).join('[redacted]') : String(error.message);
  console.error('OWNER_ACCESS_CHECK_FAILED', message); process.exitCode = 1;
});
