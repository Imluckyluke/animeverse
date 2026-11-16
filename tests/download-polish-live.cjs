/* Bounded UI regression: mocked transfer responses, no video downloads or accounts created. */
const assert = require('node:assert/strict');
const { chromium } = require('/var/lib/bot-host/.npm/_npx/f0a362733743bae2/node_modules/playwright');
(async () => {
  const base = process.env.AV_ACCOUNT_TEST_BASE;
  const browser = await chromium.launch({ executablePath: '/var/lib/bot-host/.cache/visual-qa/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--no-sandbox', '--disable-dev-shm-usage'], env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: '/tmp/opencode', LD_LIBRARY_PATH: '/tmp/opencode/animeverse-admin-browser-libs/lib' } });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.name));
    const catalog = await (await context.request.get(base + '/api/catalog-search')).json();
    let createdJobs = 0;
    page.on('request', request => { if (request.url().endsWith('/api/download-cache') && request.method() === 'POST') createdJobs++; });
    const hydrated = page.waitForResponse(response => response.url().includes('/api/account/session') && response.request().method() === 'GET');
    await page.goto(base + '/anime/' + catalog[0].slug, { waitUntil: 'domcontentloaded' });
    await hydrated;
    const picker = page.getByRole('button', { name: 'روش دانلود: مستقیم', exact: true });
    await picker.click();
    await page.getByRole('menuitemradio', { name: 'دانلود از تلگرام', exact: true }).click();
    await page.getByRole('button', { name: 'روش دانلود: تلگرام', exact: true }).waitFor();
    assert.ok(await page.locator('a[href^="https://t.me/testanivers/"]').count());
    assert.equal(createdJobs, 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.goto(base + '/admin', { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('input[type=password]').count(), 0);
    assert.equal((await context.request.get(base + '/api/admin/session')).status(), 404);
    console.log('COMPACT_PICKER_TELEGRAM_NO_JOBS_OWNER_GATE_OK');
    await context.close();

    const transfers = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const items = [{ episode: 1, quality: '720p', status: 'uploading', bytes: 25, size: 100 }, { episode: 2, quality: '720p', status: 'queued', bytes: 0, size: 100 }];
    await transfers.addInitScript(({ items, slug, otherSlug }) => {
      if (localStorage.getItem('polish-seeded')) return;
      localStorage.setItem('polish-seeded', '1');
      const row = { id: 'polish-test-request-1', slug, title: 'Polish Test Anime', quality: '720p', all: true, serverId: 'b'.repeat(64), createdAt: Date.now(), updatedAt: Date.now(), total: 2, items };
      localStorage.setItem('av_downloads_v1', JSON.stringify([row, { ...row, id: 'polish-test-request-2', slug: otherSlug, title: 'Finished Test Anime', all: false, episode: 1, serverId: 'c'.repeat(64), total: 1, items: [{ episode: 1, quality: '720p', status: 'failed', bytes: 0 }] }]));
    }, { items, slug: catalog[0].slug, otherSlug: catalog[1].slug });
    await transfers.route('**/api/account/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'd'.repeat(32), name: 'Test Reader', email: 'reader@example.test', role: 'user' }, csrf: 'test-csrf-only-not-a-cookie', preferences: { favorites: [], watched: {}, library: {}, revision: 0 } }) }));
    const controls = [];
    await transfers.route('**/api/download-cache*', async route => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON(); controls.push(body.action);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, paused: body.action === 'pause' }) });
      }
      if (route.request().url().includes('job=')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: 'c'.repeat(64), status: 'failed', bytes: 0 }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ batch: 'b'.repeat(64), status: 'queued', items }) });
    });
    const history = await transfers.newPage(); history.setDefaultTimeout(15000);
    history.on('pageerror', error => errors.push(error.name));
    await history.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await history.getByRole('button', { name: 'دانلودهای من', exact: true }).first().click();
    assert.equal(await history.locator('.download-episode').count(), 0);
    await history.locator('.download-record-heading').filter({ hasText: 'Polish Test Anime' }).click();
    await history.locator('.download-episode').first().waitFor();
    await history.getByRole('button', { name: 'توقف همهٔ قسمت‌های Polish Test Anime', exact: true }).click();
    await history.waitForFunction(() => JSON.parse(localStorage.getItem('av_downloads_v1')).find(row => row.id === 'polish-test-request-1').paused === true);
    assert.equal(await history.locator('.downloads-launcher').count(), 0);
    await history.getByRole('button', { name: 'ادامهٔ همهٔ قسمت‌های Polish Test Anime', exact: true }).click();
    await history.waitForFunction(() => JSON.parse(localStorage.getItem('av_downloads_v1')).find(row => row.id === 'polish-test-request-1').paused === false);
    assert.deepEqual(controls, ['pause', 'resume']);
    await history.getByRole('button', { name: 'حذف Polish Test Anime از تاریخچه', exact: true }).click();
    await history.getByRole('button', { name: 'حذف', exact: true }).click();
    await history.getByRole('button', { name: 'پاک‌کردن تاریخچه', exact: true }).click();
    await history.getByRole('button', { name: 'پاک‌کردن همه', exact: true }).click();
    assert.equal(await history.locator('.download-record').count(), 0);
    assert.equal(await history.locator('.downloads-launcher').count(), 0);
    assert.deepEqual(await history.evaluate(() => JSON.parse(localStorage.getItem('av_downloads_v1'))), []);
    assert.deepEqual(errors, []);
    console.log('COLLAPSE_PAUSE_RESUME_DELETE_ONE_CLEAR_ALL_ACTIVE_ICON_OK');
    await transfers.close();
  } finally { await browser.close(); }
})().catch(error => { console.error('DOWNLOAD_UI_CHECK_FAILED', error.message); process.exitCode = 1; });
