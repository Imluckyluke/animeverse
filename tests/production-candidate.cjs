/* Read-only release smoke; the one-use owner grant arrives only on stdin. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('/var/lib/bot-host/.npm/_npx/f0a362733743bae2/node_modules/playwright');

(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const browser = await chromium.launch({
    executablePath: '/var/lib/bot-host/.cache/visual-qa/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: '/tmp/opencode', LD_LIBRARY_PATH: '/tmp/opencode/animeverse-admin-browser-libs/lib' },
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const errors = [];
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    page.on('pageerror', error => errors.push(error.name));
    const access = await context.request.post(input.base + '/api/account/access', { headers: { Origin: input.base }, data: { token: input.token } });
    assert.equal(access.status(), 200, 'Owner test grant redemption');
    input.token = '';
    await page.goto(input.base + '/admin', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('heading', { name: 'نمای کلی', exact: true }).waitFor();
    assert.equal((await context.request.get(input.base + '/api/admin/overview')).status(), 200);
    const operations = page.locator('details').filter({ has: page.locator('summary', { hasText: 'جزئیات عملیات، انتشار و سرویس‌ها' }) });
    assert.equal(await operations.getAttribute('open'), null);
    await operations.locator('summary').click();
    await page.getByText('کش و فضای کاری', { exact: true }).waitFor({ state: 'visible' });
    await operations.locator('summary').click();

    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => {
        localStorage.setItem('av_theme', theme);
        document.documentElement.dataset.theme = theme;
        window.dispatchEvent(new Event('av-theme'));
      }, theme);
      await page.waitForFunction(theme => {
        const root = document.querySelector('.av-root');
        return root && getComputedStyle(root).color === (theme === 'light' ? 'rgb(42, 39, 34)' : 'rgb(245, 247, 255)');
      }, theme);
      const color = await page.locator('.av-root').evaluate(el => ({ scheme: getComputedStyle(el).colorScheme, color: getComputedStyle(el).color }));
      assert.equal(color.scheme, theme);
      assert.equal(color.color, theme === 'light' ? 'rgb(42, 39, 34)' : 'rgb(245, 247, 255)');
      const navigation = page.getByRole('navigation', { name: 'بخش‌های پنل مدیریت', exact: true });
      for (const [label, endpoint] of [['انیمه‌ها', '/api/admin/catalog'], ['بررسی فایل‌ها', '/api/admin/review'], ['دانلودها', null], ['کاربران', '/api/admin/users'], ['تاریخچه', '/api/admin/history'], ['تنظیمات', '/api/admin/settings'], ['نمای کلی', null]]) {
        const response = endpoint ? page.waitForResponse(r => r.url().includes(endpoint) && r.request().method() === 'GET') : null;
        await navigation.getByRole('button', { name: label, exact: true }).click();
        if (response) assert.equal((await response).status(), 200);
        await page.getByRole('heading', { name: label, exact: true }).first().waitFor();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Desktop overflow');
      }
      await page.screenshot({ path: `/tmp/opencode/animeverse-admin-${theme}-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      const mobile = page.getByRole('navigation', { name: 'ناوبری بخش‌های مدیریت در موبایل', exact: true });
      for (const label of ['انیمه‌ها', 'بررسی فایل‌ها', 'دانلودها', 'کاربران', 'تاریخچه', 'تنظیمات', 'نمای کلی']) {
        await mobile.getByRole('button', { name: label, exact: true }).click();
        await page.getByRole('heading', { name: label, exact: true }).first().waitFor();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Mobile overflow');
      }
      await page.screenshot({ path: `/tmp/opencode/animeverse-admin-${theme}-mobile.png`, fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      console.log('ADMIN_ALL_TABS_THEME_MOBILE_OK', theme);
    }

    const account = await (await context.request.get(input.base + '/api/account/session')).json();
    const logout = await context.request.delete(input.base + '/api/account/session', { headers: { Origin: input.base, 'X-CSRF-Token': account.csrf } });
    assert.equal(logout.status(), 200);
    for (const route of ['/api/admin/session', '/api/admin/overview', '/api/admin/users', '/api/admin/settings']) {
      assert.equal((await context.request.get(input.base + route)).status(), 404);
    }
    await page.goto(input.base + '/admin', { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('input[type=password]').count(), 0);
    const home = await context.request.get(input.base + '/');
    assert.equal(home.status(), 200);
    assert.equal(home.headers()['x-content-type-options'], 'nosniff');
    assert.equal(home.headers()['x-frame-options'], 'DENY');
    assert.ok(home.headers()['content-security-policy'].includes("frame-ancestors 'none'"));
    for (const slug of ['noragami-aragoto-ova', 'tonikaku-kawaii-sns', 'gabriel-dropout-ova']) {
      await page.goto(input.base + '/anime/' + slug, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { level: 1 }).waitFor();
      assert.ok(await page.getByText('OVA', { exact: true }).count());
    }
    assert.deepEqual(errors, []);
    console.log('CANDIDATE_SECURITY_SPECIAL_PAGES_BROWSER_OK');
  } finally {
    try {
      const account = await (await context.request.get(input.base + '/api/account/session')).json();
      if (account.csrf) await context.request.delete(input.base + '/api/account/session', { headers: { Origin: input.base, 'X-CSRF-Token': account.csrf } });
    } catch { /* Cleanup is restricted to this browser's temporary test session. */ }
    await context.close();
    await browser.close();
  }
  require('node:child_process').execFileSync('node', [__dirname + '/download-polish-live.cjs'], {
    env: { ...process.env, AV_ACCOUNT_TEST_BASE: input.base }, stdio: 'inherit', timeout: 90000,
  });
})().catch(error => { console.error('CANDIDATE_BROWSER_FAILED', String(error.message).replace(/https?:\/\/\S+/g, '[url]')); process.exitCode = 1; });
