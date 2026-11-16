/* One-use owner grant on stdin. No Telegram tokens or preference changes. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('/var/lib/bot-host/.npm/_npx/f0a362733743bae2/node_modules/playwright');
let secret = '';

(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  secret = input.token;
  const base = new URL(input.base).origin;
  const browser = await chromium.launch({
    executablePath: '/var/lib/bot-host/.cache/visual-qa/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: '/tmp/opencode', LD_LIBRARY_PATH: '/var/lib/bot-host/.cache/visual-qa/sysroot/usr/lib/x86_64-linux-gnu' },
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const errors = [], notificationReads = [], unexpectedMutations = [];
    page.on('pageerror', error => errors.push(error.name));
    await context.route('**/api/notifications/**', route => {
      const request = route.request();
      if (request.method() !== 'GET') { unexpectedMutations.push(request.method()); return route.abort(); }
      notificationReads.push(new URL(request.url()).search);
      return route.continue();
    });
    assert.equal((await context.request.get(base + '/api/notifications/status?clientId=not-an-account')).status(), 401);
    await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'ورود به حساب', exact: true }).waitFor();
    assert.equal(await page.locator('[data-telegram-notify]').count(), 0, 'Guests have no personal notification rows');
    assert.equal(notificationReads.length, 0, 'Guests do not poll personal notifications');

    const access = await context.request.post(base + '/api/account/access', { headers: { Origin: base }, data: { token: input.token } });
    assert.equal(access.status(), 200); input.token = '';
    const account = await (await context.request.get(base + '/api/account/session')).json();
    const response = await context.request.get(base + '/api/notifications/status');
    assert.equal(response.status(), 200);
    assert.match(response.headers()['cache-control'], /private.*no-store/);
    const status = await response.json();
    assert.equal(status.linked, true, 'Recovered owner connection is present');
    assert.equal(status.workerHealthy, true, 'The actual notification worker is healthy');
    assert.equal(status.favoritesCount, account.preferences.favorites.length);
    assert.equal(status.botUsername, 'Anotifersbot');
    assert.equal('chatId' in status, false, 'Chat identity is not exposed to the browser');
    assert.equal((await context.request.post(base + '/api/notifications/preferences', { headers: { Origin: base }, data: { enabled: !status.enabled } })).status(), 403);
    assert.equal((await context.request.delete(base + '/api/notifications/unlink', { headers: { Origin: base } })).status(), 403);
    const forged = await context.request.post(base + '/api/notifications/preferences', {
      headers: { Origin: base, 'X-CSRF-Token': account.csrf }, data: { enabled: status.enabled, favorites: [], clientId: 'forged-browser-id' },
    });
    assert.equal(forged.status(), 422, 'Client-controlled identity/favorites are never accepted');

    for (const theme of ['light', 'dark']) {
      await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
      await page.evaluate(theme => {
        localStorage.setItem('av_theme', theme); document.documentElement.dataset.theme = theme;
        window.dispatchEvent(new Event('av-theme'));
      }, theme);
      await page.getByRole('heading', { name: 'حساب کاربری', exact: true }).waitFor();
      const card = page.locator('[data-telegram-notify="card"]');
      await card.waitFor();
      const toggle = card.getByRole('switch');
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute('aria-checked'), String(status.enabled));
      assert.ok(await card.getByRole('button', { name: 'قطع اتصال', exact: true }).count());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No mobile overflow');
      await card.screenshot({ path: `/tmp/opencode/notification-account-${theme}.png` });
      console.log('ACCOUNT_NOTIFICATION_MOBILE_THEME_OK', theme);
    }
    assert.ok(notificationReads.length > 0);
    assert.ok(notificationReads.every(query => query === ''), 'No anonymous query identity');
    assert.deepEqual(unexpectedMutations, []);
    assert.deepEqual(errors, []);
    const after = await (await context.request.get(base + '/api/account/session')).json();
    assert.deepEqual(after.preferences, account.preferences, 'Account favorites/history remain unchanged');
    assert.equal((await context.request.delete(base + '/api/account/session', { headers: { Origin: base, 'X-CSRF-Token': after.csrf } })).status(), 200);
    assert.equal((await context.request.get(base + '/api/notifications/status')).status(), 401);
    console.log('AUTHENTICATED_NOTIFICATION_ROUTE_AND_PRIVACY_GATE_OK');
  } finally {
    try {
      const session = await (await context.request.get(base + '/api/account/session')).json();
      if (session.csrf) await context.request.delete(base + '/api/account/session', { headers: { Origin: base, 'X-CSRF-Token': session.csrf } });
    } catch { /* Only this browser's temporary test session is cleaned up. */ }
    await context.close(); await browser.close();
  }
})().catch(error => {
  const message = String(error.message).split(secret || '\0').join('[redacted]')
    .replace(/https?:\/\/\S+/g, '[url]').replace(/\b[A-Za-z0-9_-]{40,128}\b/g, '[opaque]');
  console.error('NOTIFICATION_BROWSER_GATE_FAILED', message);
  process.exitCode = 1;
});
