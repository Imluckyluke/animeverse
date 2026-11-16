/* Public, read-only mobile footer and original-airing-time release gate. */
const assert = require('node:assert/strict');
const { chromium } = require('/var/lib/bot-host/.npm/_npx/f0a362733743bae2/node_modules/playwright');
const fs = require('node:fs');

(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const base = new URL(input.base).origin;
  const browser = await chromium.launch({
    executablePath: '/var/lib/bot-host/.cache/visual-qa/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: '/tmp/opencode', LD_LIBRARY_PATH: '/var/lib/bot-host/.cache/visual-qa/sysroot/usr/lib/x86_64-linux-gnu' },
  });
  const context = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  try {
    for (const width of [320, 360, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.goto(base + '/anime/toaru-kagaku-no-railgun', { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(theme => {
          localStorage.setItem('av_theme', theme); document.documentElement.dataset.theme = theme;
          window.dispatchEvent(new Event('av-theme'));
        }, theme);
        const footer = page.locator('footer');
        await footer.scrollIntoViewIfNeeded();
        const measured = await footer.evaluate(element => ({
          height: Math.round(element.getBoundingClientRect().height),
          links: [...element.querySelectorAll('a')].map(anchor => anchor.getAttribute('href')),
        }));
        const baseline = input.footerBefore?.find(item => item.width === width);
        if (width < 640) {
          assert.ok(measured.height <= 470, `Mobile footer remains shorter without compressing its content: ${measured.height}px`);
          if (baseline) assert.ok(measured.height <= baseline.height * .87, 'Still shorter than the original stacked footer');
          const layout = await footer.evaluate(element => {
            const brand = element.querySelector('.hwf-brand').getBoundingClientRect();
            const navs = [...element.querySelectorAll('.hwf-col')];
            return {
              brandBottom: brand.bottom,
              columns: navs.map(nav => { const r = nav.getBoundingClientRect(); return { width: r.width, top: r.top, bottom: r.bottom }; }),
              listDisplays: navs.slice(0, 2).map(nav => getComputedStyle(nav.querySelector('ul')).display),
              links: [...element.querySelectorAll('.hwf-col a')].map(link => {
                const range = document.createRange(); range.selectNodeContents(link);
                return { text: link.textContent, lines: range.getClientRects().length, fontSize: parseFloat(getComputedStyle(link).fontSize), height: link.getBoundingClientRect().height };
              }),
            };
          });
          assert.ok(layout.columns[0].top >= layout.brandBottom + 16, 'Brand has a separate row with breathing room');
          assert.ok(layout.columns[2].top >= Math.max(layout.columns[0].bottom, layout.columns[1].bottom) + 16, 'Contact is a separate full-width row');
          assert.ok(layout.columns.slice(0, 2).every(column => column.width >= 120), 'Navigation is not squeezed into tiny columns');
          assert.deepEqual(layout.listDisplays, ['block', 'block']);
          for (const link of layout.links) {
            assert.equal(link.lines, 1, `No broken link label: ${link.text}`);
            assert.ok(link.fontSize >= 12.5 && link.height >= 40, 'Readable type and comfortable touch targets');
          }
        } else if (baseline) assert.ok(Math.abs(measured.height - baseline.height) <= 24, 'Desktop footer layout is preserved');
        for (const href of ['/', '/browse', '/login', '/privacy', '/terms', 'https://t.me/ImLuckyluke', 'https://t.me/testanivers']) assert.ok(measured.links.includes(href), `Footer link preserved: ${href}`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No horizontal page overflow');
        await footer.screenshot({ path: `/tmp/opencode/footer-refined-${theme}-${width}.png` });
        console.log('COMPACT_FOOTER_THEME_OK', theme, width, measured.height);
        if (width < 640) {
          // Read-only DOM fixture for the extra link rendered by AccountFooter.
          // This tests the taller signed-in layout without a real login/session.
          await footer.evaluate(element => {
            const account = element.querySelectorAll('.hwf-col')[1];
            account.querySelector('h3').textContent = 'کتابخانه';
            const item = document.createElement('li'), link = document.createElement('a');
            link.href = '/favorites'; link.textContent = 'کتابخانهٔ من';
            item.append(link); account.querySelector('ul').prepend(item);
          });
          const fixture = await footer.evaluate(element => {
            const link = element.querySelector('a[href="/favorites"]');
            const range = document.createRange(); range.selectNodeContents(link);
            return { height: Math.round(element.getBoundingClientRect().height), lines: range.getClientRects().length, overflow: element.scrollWidth > element.clientWidth + 1 };
          });
          assert.ok(fixture.height <= 470 && !fixture.overflow, 'The taller signed-in footer also has breathing room');
          assert.equal(fixture.lines, 1, 'The library link is not squeezed into a broken label');
          await footer.screenshot({ path: `/tmp/opencode/footer-signed-in-layout-${theme}-${width}.png` });
          console.log('SIGNED_IN_FOOTER_LAYOUT_FIXTURE_OK', theme, width, fixture.height);
        }
      }
    }
    for (const sample of input.airingExamples || []) {
      await page.goto(base + '/anime/' + sample.slug, { waitUntil: 'load' });
      const hero = page.locator('.anime-detail-hero');
      const time = hero.locator('[data-next-airing] time');
      assert.equal(await time.count(), 1, 'Verified original airing schedule appears below the cover');
      assert.equal(await time.getAttribute('datetime'), sample.airingAt);
      assert.ok((await hero.locator('[data-next-airing]').innerText()).includes('به وقت تهران'));
      const expectedClock = new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit' }).format(new Date(sample.airingAt));
      assert.ok((await time.innerText()).includes(expectedClock), 'Airing time is converted to Tehran, not browser locale');
      assert.equal(await hero.locator('[data-latest-episode]').count(), 0);
      await hero.screenshot({ path: `/tmp/opencode/verified-airing-${sample.slug}.png` });
      console.log('VERIFIED_ORIGINAL_AIRING_TIME_OK', sample.slug);
    }
    assert.deepEqual(errors, []);
    console.log('DETAIL_AND_FOOTER_BROWSER_GATE_OK');
  } finally { await context.close(); await browser.close(); }
})().catch(error => {
  console.error('DETAIL_FOOTER_GATE_FAILED', String(error.stack || error.message).replace(/https?:\/\/\S+/g, '[url]'));
  process.exitCode = 1;
});
