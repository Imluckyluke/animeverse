/* Manual live smoke. JSON credentials arrive on stdin, never argv/storage/logs. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.AV_PLAYWRIGHT_MODULE || '/var/lib/bot-host/.npm/_npx/f0a362733743bae2/node_modules/playwright');
let protectedPassword = '';

(async () => {
  const config = JSON.parse(fs.readFileSync(0, 'utf8'));
  protectedPassword = config.password;
  const browser = await chromium.launch({ executablePath: '/var/lib/bot-host/.cache/visual-qa/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'], env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8', TMPDIR: '/tmp/opencode', LD_LIBRARY_PATH: process.env.AV_BROWSER_LIBRARY_PATH || '/tmp/opencode/animeverse-admin-browser-libs/lib' } });
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.name));
  try {
    await page.goto(config.base + '/admin', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByRole('button', { name: 'ورود امن', exact: true }).waitFor({ timeout: 45000 });
    await page.locator('input[type=password]').fill(config.password);
    const login = page.waitForResponse(response => response.url().endsWith('/api/admin/session') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'ورود امن', exact: true }).click();
    assert.equal((await login).status(), 200, 'Real browser login failed');
    await page.getByRole('heading', { name: 'نمای کلی', exact: true }).waitFor({ timeout: 45000 });
    const cookies = await context.cookies(config.base);
    const session = cookies.find(cookie => cookie.name.endsWith('av_admin_session'));
    assert.ok(session && session.httpOnly && session.secure && session.sameSite === 'Strict');
    assert.equal(await page.evaluate(() => document.cookie.includes('av_admin_session')), false);
    const leaked = await page.evaluate(password => Object.values(localStorage).some(value => value.includes(password)), config.password);
    assert.equal(leaked, false, 'Admin password persisted in localStorage');
    config.password = '';
    const tabs = [
      ['کاتالوگ', '/api/admin/catalog'], ['بازبینی آرشیو', '/api/admin/review'], ['دانلود و کش', null],
      ['کاربران', '/api/admin/users'], ['تاریخچه', '/api/admin/history'], ['تنظیمات', '/api/admin/settings'],
    ];
    for (const [label, endpoint] of tabs) {
      const response = endpoint ? page.waitForResponse(response => response.url().includes(endpoint) && response.request().method() === 'GET', { timeout: 60000 }) : null;
      await page.getByRole('navigation', { name: 'بخش‌های پنل مدیریت', exact: true }).getByRole('button', { name: label, exact: true }).click();
      if (response) assert.equal((await response).status(), 200, 'Admin tab backend failed');
      await page.getByRole('heading', { name: label, exact: true }).first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Desktop overflow: ' + label);
      console.log('ADMIN_BROWSER_TAB_OK', label);
    }
    const output = config.output || '/tmp/opencode';
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'admin-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileOverview = page.waitForResponse(response => response.url().includes('/api/admin/overview') && response.request().method() === 'GET', { timeout: 60000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'نمای کلی', exact: true }).waitFor({ timeout: 45000 });
    assert.equal((await mobileOverview).status(), 200);
    await page.getByText('عنوان‌ها', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Mobile overflow');
    await page.screenshot({ path: path.join(output, 'admin-mobile.png'), fullPage: true });
    const mobileNav = page.getByRole('navigation', { name: 'ناوبری بخش‌های مدیریت در موبایل', exact: true });
    await mobileNav.getByRole('button', { name: 'کاتالوگ', exact: true }).click();
    await page.getByRole('heading', { name: 'کاتالوگ', exact: true }).first().waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Mobile catalog overflow');
    assert.deepEqual(errors, [], 'Browser runtime exceptions');
    const csrf = await page.evaluate(async () => (await (await fetch('/api/admin/session')).json()).session.csrf);
    const logout = await context.request.delete(config.base + '/api/admin/session', { headers: { Origin: config.base, 'X-CSRF-Token': csrf } });
    assert.equal(logout.status(), 200);
    console.log('ADMIN_DESKTOP_MOBILE_BROWSER_PASSED');
  } finally { await browser.close(); }
})().catch(error => {
  let message = String(error.message);
  if (protectedPassword) message = message.split(protectedPassword).join('[redacted]');
  console.error('ADMIN_BROWSER_FAILED', message.replace(/https?:\/\/\S+/g, '[url]'));
  process.exitCode = 1;
});
