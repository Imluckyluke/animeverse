/* Public UI QA with synthetic status replies. No account is created, no
 * credentials are used and no video is requested or downloaded. */
const assert = require('node:assert/strict');
const { chromium } = require('/var/lib/bot-host/.npm/_npx/f0a362733743bae2/node_modules/playwright');
const base = process.env.AV_PROGRESSIVE_UI_BASE || 'https://animeverse-xi.vercel.app';
const signed = 'https://anime.bayerkashan.ir/media/' + 'a'.repeat(64) + '/' + 'b'.repeat(32) + '/1800000000/' + 'c'.repeat(64);

(async () => {
  const browser = await chromium.launch({
    executablePath: '/var/lib/bot-host/.cache/visual-qa/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: '/tmp/opencode', LD_LIBRARY_PATH: '/var/lib/bot-host/.cache/visual-qa/sysroot/usr/lib/x86_64-linux-gnu' },
  });
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const errors = [];
      let ready = false;
      const item = { episode: 175, quality: '480p', job: 'a'.repeat(64), status: 'uploading', provider: 'local', live: true, bytes: 20, size: 100, streamBytes: 10, phase: 'receiving', url: signed };
      await context.addInitScript(item => {
        localStorage.setItem('av_downloads_v1', JSON.stringify([{
          id: 'progressive-browser-qa-20261104', slug: 'black-clover-season-2', title: 'Progressive browser QA', quality: '480p', episode: 175,
          all: false, total: 1, serverId: 'a'.repeat(64), createdAt: Date.now(), updatedAt: Date.now(), items: [item],
        }]));
      }, item);
      await context.route('**/api/account/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        user: { id: 'd'.repeat(32), name: 'QA Reader', email: 'qa@example.test', role: 'user' }, csrf: 'synthetic-qa-not-a-cookie',
        preferences: { favorites: [], watched: {}, library: {}, revision: 0 },
      }) }));
      await context.route('**/api/download-cache*', route => {
        if (route.request().method() === 'PATCH') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, paused: route.request().postDataJSON().action === 'pause' }) });
        }
        return route.fulfill({ status: ready ? 200 : 202, contentType: 'application/json', body: JSON.stringify(ready
          ? { ...item, status: 'ready', live: undefined, streamBytes: undefined, phase: 'ready', bytes: 100 }
          : item) });
      });
      // Do not match Next's /_next/static/media/ font assets here.
      await context.route('https://anime.bayerkashan.ir/media/**', route => route.abort());
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.setDefaultTimeout(30000);
      await page.goto(base + '/anime/black-clover-season-2', { waitUntil: 'domcontentloaded' });
      // This minimal headless host has no system fallback font. Wait for the
      // site's real Persian font before judging text visibility/layout.
      await page.evaluate(()=>document.fonts.ready);
      await page.getByRole('button', { name: 'دانلودهای من', exact: true }).first().click();
      await page.locator('.download-record-heading').filter({ hasText: 'Progressive browser QA' }).click();
      const live = page.getByRole('link', { name: 'دانلود مستقیم قسمت ۱۷۵', exact: true });
      await live.waitFor();
      assert.equal(await live.getAttribute('href'), signed);
      assert.notEqual(await live.getAttribute('download'), null);
      const progress = page.getByRole('progressbar');
      assert.equal(await progress.getAttribute('aria-valuenow'), '20');
      assert.match(await progress.getAttribute('aria-label'), /سرور/);
      const note=page.getByText(/نه پیشرفت دانلود روی گوشی/);
      await note.evaluate(e=>e.scrollIntoView({block:'nearest'}));
      try { await note.waitFor(); }
      catch (error) {
        await page.screenshot({path:'/tmp/opencode/progressive-ui-diagnostic.png'});
        console.log('LIVE_NOTE_DIAGNOSTIC', await note.evaluate(element => {
          const chain=[];
          for(let e=element;e&&chain.length<7;e=e.parentElement){
            const s=getComputedStyle(e),r=e.getBoundingClientRect();
            chain.push({tag:e.tagName,cls:e.className,display:s.display,visibility:s.visibility,height:r.height,width:r.width,style:e.getAttribute('style')});
          }
          return chain;
        }));
        throw error;
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      await page.getByRole('button', { name: 'توقف قسمت ۱۷۵ با کیفیت 480p', exact: true }).click();
      await live.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'ادامهٔ قسمت ۱۷۵ با کیفیت 480p', exact: true }).click();
      await live.waitFor();
      ready = true;
      await page.waitForFunction(()=>document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')==='100');
      await live.waitFor();
      assert.equal(await progress.getAttribute('aria-valuenow'), '100');
      assert.deepEqual(errors, []);
      console.log('PROGRESSIVE_UI_OK', width, 'live/pause/resume/verified-ready');
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error('PROGRESSIVE_UI_FAILED', error.message); process.exitCode = 1; });
