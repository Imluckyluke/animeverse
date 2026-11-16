/* Browser regression with mocked transfers: no accounts or video jobs created. */
const assert = require('node:assert/strict');
const { chromium } = require('/var/lib/bot-host/.npm/_npx/f0a362733743bae2/node_modules/playwright');
const base = process.env.AV_ACCOUNT_TEST_BASE;

(async () => {
  assert.ok(base);
  const browser = await chromium.launch({ executablePath: '/var/lib/bot-host/.cache/visual-qa/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--no-sandbox'], env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: '/tmp/opencode', LD_LIBRARY_PATH: '/tmp/opencode/animeverse-admin-browser-libs/lib' } });
  let observedPage;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const catalog = await (await context.request.get(base + '/api/catalog-search')).json();
    assert.ok(catalog.length > 1);
    const slug = catalog[0].slug, otherSlug = catalog[1].slug;
    const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64), d = 'd'.repeat(64), batch = 'f'.repeat(64);
    const singleOne = 'group-single-episode-one', singleTwo = 'group-single-episode-two', bulk = 'group-bulk-request-valid', other = 'group-other-anime-valid';
    const transfer = (episode, job) => ({ episode, job, quality: '720p', status: 'queued', bytes: 0, size: 100 });
    const items = [transfer(2, b), transfer(3, c)];
    const now = Date.now();
    const row = { slug, title: 'Grouped Anime', quality: '720p', all: false, createdAt: now, updatedAt: now, total: 1 };
    const records = [
      { ...row, id: singleOne, episode: 1, serverId: a, items: [transfer(1, a)] },
      { ...row, id: singleTwo, episode: 2, serverId: b, items: [transfer(2, b)] },
      { ...row, id: bulk, all: true, total: 2, serverId: batch, items },
      { ...row, id: other, slug: otherSlug, title: 'Other Anime', episode: 1, serverId: d, items: [transfer(1, d)] },
    ];
    await context.addInitScript(records => {
      if (localStorage.getItem('group-test-seeded')) return;
      localStorage.setItem('group-test-seeded', '1'); localStorage.setItem('av_theme', 'light');
      localStorage.setItem('av_downloads_v1', JSON.stringify(records));
    }, records);
    await context.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.__groupSessionProbe = [];
      window.fetch = async (...args) => {
        const session = String(args[0]).includes('/api/account/session');
        try {
          const response = await original(...args);
          if (session) {
            const data = await response.clone().json();
            window.__groupSessionProbe.push({ status: response.status, user: Boolean(data.user), idLength: data.user?.id?.length, csrfLength: data.csrf?.length });
          }
          return response;
        } catch (error) { if (session) window.__groupSessionProbe.push({ error: error.name }); throw error; }
      };
    });
    let sessions = 0;
    await context.route('**/api/account/session', route => { sessions++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: '1'.repeat(32), name: 'Test Reader', email: 'reader@example.test', role: 'user' }, csrf: 'f'.repeat(43), preferences: { favorites: [], watched: {}, library: {}, revision: 0 } }) }); });
    const controls = []; let posts = 0;
    await context.route('**/api/download-cache*', async route => {
      const request = route.request();
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON(); controls.push(body);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, paused: body.action === 'pause' }) });
      }
      if (request.method() === 'POST') { posts++; return route.fulfill({ status: 500, body: '{}' }); }
      const url = new URL(request.url());
      const response = url.searchParams.has('batch') ? { batch, slug, quality: '720p', total: 2, status: 'queued', items }
        : { ...transfer(url.searchParams.get('job') === b ? 2 : 1, url.searchParams.get('job')), status: 'queued' };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    });
    const errors = [];
    const page = await context.newPage(); page.setDefaultTimeout(25000);
    observedPage = page;
    page.on('pageerror', error => { errors.push(error.name + ': ' + error.message); console.error('GROUP_BROWSER_RUNTIME_ERROR', error.message.slice(0, 200)); });
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    console.log('GROUP_BROWSER_HOME_LOADED');
    try { await page.locator('.downloads-launcher').click(); }
    catch (error) {
      console.log('GROUP_FIXTURE_DIAGNOSTIC', JSON.stringify({ sessions, errors, state: await page.evaluate(() => ({ session: window.__groupSessionProbe, seeded: Boolean(localStorage.getItem('group-test-seeded')), storedRows: JSON.parse(localStorage.getItem('av_downloads_v1') || '[]').map(row => ({ id: row.id, slug: row.slug, items: row.items.length, total: row.total })), themeEnabled: !document.querySelector('.theme-toggle')?.disabled, accountButtons: document.querySelectorAll('.header-account-disc').length, hasGuestLogin: Boolean(document.querySelector('a[href="/login"]')), launchers: document.querySelectorAll('.downloads-launcher').length })) }));
      throw error;
    }
    await page.waitForFunction(() => document.querySelectorAll('.download-record').length === 2);
    const group = page.locator(`[data-download-anime="${slug}"]`);
    assert.equal(await group.locator('.download-record-heading').getByText('Grouped Anime', { exact: true }).count(), 1);
    assert.equal(await page.locator('.download-episode').count(), 0);
    await group.locator('.download-record-heading').click();
    await page.waitForFunction(slug => document.querySelector(`[data-download-anime="${slug}"]`).querySelectorAll('.download-episode').length === 3, slug);
    const episode = number => group.locator(`[data-download-episode="${number}"]`);
    const pause = number => episode(number).getByRole('button', { name: new RegExp('^توقف قسمت') });
    const resume = number => episode(number).getByRole('button', { name: new RegExp('^ادامهٔ قسمت') });
    await pause(3).click();
    await resume(3).click();
    await page.waitForFunction(bulk => { const row = JSON.parse(localStorage.getItem('av_downloads_v1')).find(row => row.id === bulk); return row.itemPaused?.['3|720p'] === false && !row.itemControls?.['3|720p']; }, bulk);
    assert.deepEqual(controls.slice(0, 2).map(body => [body.requestId, body.id, body.job, body.action]), [[bulk, batch, c, 'pause'], [bulk, batch, c, 'resume']]);
    assert.equal(await pause(1).isEnabled(), true);
    await group.getByRole('button', { name: 'توقف همهٔ قسمت‌های Grouped Anime', exact: true }).click();
    await resume(1).waitFor();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('av_downloads_v1')).filter(row => row.title === 'Grouped Anime').every(row => row.paused === true && !row.control));
    assert.ok(controls.filter(body => body.action === 'pause' && !body.job).length >= 3);
    await resume(3).click();
    await pause(3).click();
    assert.equal(await resume(1).isEnabled(), true);
    await group.getByRole('button', { name: 'ادامهٔ همهٔ قسمت‌های Grouped Anime', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('av_downloads_v1')).filter(row => row.title === 'Grouped Anime').every(row => row.paused === false && !row.control && !Object.keys(row.itemPaused || {}).length));
    await page.screenshot({ path: '/tmp/opencode/animeverse-download-groups-light-mobile.png' });
    const beforeDelete = controls.length;
    await episode(2).getByRole('button', { name: /^حذف قسمت/ }).click();
    await episode(2).getByRole('button', { name: 'حذف', exact: true }).click();
    await page.waitForFunction(slug => document.querySelector(`[data-download-anime="${slug}"]`).querySelectorAll('.download-episode').length === 2, slug);
    assert.equal(controls.length, beforeDelete, 'History removal must not silently cancel transfers');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.locator('.downloads-launcher').click();
    await group.locator('.download-record-heading').click();
    await page.waitForFunction(slug => document.querySelector(`[data-download-anime="${slug}"]`).querySelectorAll('.download-episode').length === 2, slug);
    assert.equal(await episode(2).count(), 0);
    assert.equal(await group.locator('.download-episode').count(), 2);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('av_downloads_v1')));
    assert.ok(stored.some(row => row.id === singleOne && row.serverId === a));
    assert.ok(stored.some(row => row.id === bulk && row.serverId === batch && row.removedItems['2|720p']));
    await page.evaluate(() => { localStorage.setItem('av_theme', 'dark'); document.documentElement.dataset.theme = 'dark'; window.dispatchEvent(new Event('av-theme')); });
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#downloads-heading')).color.match(/\d+/)[0]) > 180);
    await page.screenshot({ path: '/tmp/opencode/animeverse-download-groups-dark-mobile.png' });
    assert.ok(await page.locator('.downloads-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 2));
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    const second = await context.newPage(); second.setDefaultTimeout(25000);
    second.on('pageerror', error => errors.push(error.name));
    await second.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await second.locator('.downloads-launcher').click();
    const otherGroup = second.locator(`[data-download-anime="${slug}"]`);
    await otherGroup.locator('.download-record-heading').click();
    await episode(1).getByRole('button', { name: /^حذف قسمت/ }).click();
    await episode(1).getByRole('button', { name: 'حذف', exact: true }).click();
    await second.waitForFunction(slug => !document.querySelector(`[data-download-anime="${slug}"] [data-download-episode="1"]`), slug);
    await otherGroup.getByRole('button', { name: 'حذف Grouped Anime از تاریخچه', exact: true }).click();
    await otherGroup.getByRole('button', { name: 'حذف', exact: true }).click();
    await page.waitForFunction(slug => !document.querySelector(`[data-download-anime="${slug}"]`), slug);
    assert.equal(await page.locator(`[data-download-anime="${otherSlug}"]`).count(), 1);
    await second.getByRole('button', { name: 'پاک‌کردن تاریخچه', exact: true }).click();
    await second.getByRole('button', { name: 'پاک‌کردن همه', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.download-record').length === 0);
    assert.equal(await second.locator('.downloads-launcher').count(), 0);
    assert.equal(posts, 0);
    assert.deepEqual(errors, []);
    console.log('DOWNLOAD_GROUPS_MOBILE_DESKTOP_SCOPED_CONTROLS_HISTORY_CROSSTAB_OK');
    await context.close();
  } catch (error) {
    if (observedPage && !observedPage.isClosed()) {
      console.log('GROUP_BROWSER_FAILURE_STATE', JSON.stringify(await observedPage.evaluate(() => ({ cards: [...document.querySelectorAll('.download-record')].map(card => ({ slug: card.dataset.downloadAnime, expanded: card.querySelector('.download-record-heading')?.getAttribute('aria-expanded'), episodes: [...card.querySelectorAll('.download-episode')].map(el => el.dataset.downloadEpisode), text: card.innerText.slice(0, 800) })), records: JSON.parse(localStorage.getItem('av_downloads_v1') || '[]').map(row => ({ id: row.id, paused: row.paused, control: row.control, itemPaused: row.itemPaused, itemControls: row.itemControls, items: row.items.map(item => ({ episode: item.episode, status: item.status, job: Boolean(item.job) })) })) }))));
      await observedPage.screenshot({ path: '/tmp/opencode/animeverse-download-groups-failure.png' });
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error('DOWNLOAD_GROUPS_BROWSER_FAILED', String(error.stack || error.message).replace(/https?:\/\/\S+/g, '[url]')); process.exitCode = 1; });
