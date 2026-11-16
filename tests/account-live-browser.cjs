const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('/var/lib/bot-host/.npm/_npx/f0a362733743bae2/node_modules/playwright');
(async () => {
  const base = process.env.AV_ACCOUNT_TEST_BASE || 'https://animeverse-xi.vercel.app';
  const browser = await chromium.launch({ executablePath: '/var/lib/bot-host/.cache/visual-qa/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage'], env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: '/tmp/opencode', LD_LIBRARY_PATH: '/tmp/opencode/animeverse-admin-browser-libs/lib' } });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.name));
    const catalog = await (await context.request.get(base + '/api/catalog-search')).json();
    const salt = 'legacy-browser-test-salt';
    const account = { name: 'Legacy Reader', email: 'legacy-browser@example.test', salt, hash: crypto.createHash('sha256').update(salt + ':abc123').digest('hex'), role: 'owner' };
    await context.addInitScript(({ account, slug }) => {
      if (localStorage.getItem('legacy-test-seeded')) return;
      localStorage.setItem('legacy-test-seeded', '1');
      localStorage.setItem('av_accounts', JSON.stringify([account]));
      localStorage.setItem('av_user', JSON.stringify({ name: account.name, email: account.email }));
      localStorage.setItem('av_favorites', JSON.stringify([slug]));
    }, { account, slug: catalog[0].slug });
    // A missing server account must fall back only to the verified local identity.
    await context.route('**/api/account/login', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'ایمیل یا رمز درست نیست.' }) }));
    await page.goto(base + '/favorites', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'برای دیدن کتابخانه وارد شو' }).waitFor({ timeout: 30000 });
    assert.equal(await page.getByRole('link', { name: 'کتابخانه', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'دانلودهای من', exact: true }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'کتابخانهٔ من', exact: true }).count(), 0);
    await page.getByRole('link', { name: 'ورود به حساب', exact: true }).click();
    await page.locator('#email').fill(account.email);
    await page.locator('#password').fill('abc123');
    await page.locator('form button[type=submit]').click();
    await page.waitForURL(base + '/');
    await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
    await page.getByText('حساب قدیمی این دستگاه بازیابی شده؛ این ورود محلی است و دسترسی مدیریتی نمی‌دهد.', { exact: true }).waitFor({ timeout: 30000 });
    assert.equal(await page.getByRole('link', { name: 'پنل ادمین', exact: true }).count(), 0);
    await page.goto(base + '/favorites', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'کتابخانهٔ من', exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole('region', { name: 'علاقه‌مندی‌ها', exact: true }).waitFor();
    await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'خروج از حساب', exact: true }).click();
    await page.waitForURL(base + '/');
    await page.goto(base + '/favorites', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'برای دیدن کتابخانه وارد شو' }).waitFor();
    const retained = await page.evaluate(() => Boolean(localStorage.getItem('av_accounts') && localStorage.getItem('av_favorites')));
    assert.ok(retained);
    assert.deepEqual(errors, []);
    console.log('GUEST_PRIVACY_SIX_CHARACTER_LEGACY_LOGIN_RELOAD_LOGOUT_PASSED');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error('ACCOUNT_BROWSER_FAILED', error.message); process.exitCode = 1; });
