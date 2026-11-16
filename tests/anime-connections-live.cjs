/* Public, read-only relation/recommendation interaction gate. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('/var/lib/bot-host/.npm/_npx/f0a362733743bae2/node_modules/playwright');

(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const base = new URL(input.base).origin;
  const browser = await chromium.launch({
    executablePath: '/var/lib/bot-host/.cache/visual-qa/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: '/tmp/opencode', LD_LIBRARY_PATH: '/var/lib/bot-host/.cache/visual-qa/sysroot/usr/lib/x86_64-linux-gnu' },
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  try {
    for (const width of [360, 390, 1440]) {
      await page.setViewportSize({ width, height: width > 500 ? 1000 : 844 });
      for (const theme of ['light', 'dark']) {
        console.log('CONNECTIONS_VIEWPORT_START', theme, width);
        await page.goto(base + '/anime/toaru-kagaku-no-railgun#related', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(theme => {
          localStorage.setItem('av_theme', theme); document.documentElement.dataset.theme = theme;
          window.dispatchEvent(new Event('av-theme'));
        }, theme);
        const section = page.locator('#related');
        const hero = page.locator('.anime-detail-hero');
        assert.equal(await hero.locator('[data-latest-episode]').count(), 0, 'No duplicate latest-episode label over the cover');
        assert.equal((await hero.innerText()).includes('آخرین اپیزود'), false);
        assert.equal((await hero.innerText()).includes('زمان انتشار هنوز اعلام نشده'), false);
        const about = await page.locator('#info').innerText();
        assert.equal(about.includes('قسمت‌های ثبت‌شده در آرشیو'), false);
        assert.equal(about.includes('قسمت‌های دارای لینک آماده در آخرین همگام‌سازی'), false);
        assert.ok(about.includes('کل قسمت‌های اعلام‌شده'));
        await section.getByRole('tablist').waitFor();
        assert.equal(await section.getByRole('heading', { level: 2 }).count(), 0);
        const copy = await section.innerText();
        for (const removed of ['نخ‌های داستان', 'مسیر و پیشنهاد', 'فصل‌های قبل و بعد،', 'آخرین بازبینی', 'AniList', 'مشاهده مرجع']) assert.equal(copy.includes(removed), false, removed);
        assert.equal(await section.locator('a[href^="https:"]').count(), 0, 'No external destination or source button');
        await section.evaluate(element => { element.scrollIntoView({ block: 'start' }); window.scrollBy(0, -110); });
        const tabs = section.getByRole('tab');
        assert.equal(await tabs.count(), 2);
        const related = tabs.nth(0), similar = tabs.nth(1);
        const selected = async (target) => {
          const id = await target.getAttribute('id');
          await page.waitForFunction(id => document.getElementById(id)?.getAttribute('aria-selected') === 'true', id);
        };
        // Server-rendered headings precede hydration. A real state-changing
        // click confirms interactivity before testing immediate keyboard input.
        await similar.click(); await selected(similar);
        await related.click(); await selected(related);
        const relatedPanel = section.getByRole('tabpanel');
        assert.ok(await relatedPanel.locator('li').count() > 0, 'Railgun has verified related works');
        const relatedLinks = await relatedPanel.locator('li a').evaluateAll(links => links.map(link => link.getAttribute('href')));
        assert.ok(relatedLinks.some(href => href.startsWith('/anime/')), 'Verified local related pages exist');
        assert.ok(relatedLinks.every(href => href.startsWith('/anime/')), 'Every related card points to our own anime page');
        assert.equal(new Set(relatedLinks).size, relatedLinks.length, 'Related cards are deduplicated');
        assert.equal(await section.locator('[role=tabpanel]').count(), 2, 'Both controlled tabpanels exist');
        await related.focus();
        await page.keyboard.press('ArrowLeft');
        await selected(similar);
        assert.equal(await similar.getAttribute('aria-selected'), 'true');
        assert.equal(await similar.getAttribute('tabindex'), '0');
        assert.equal(await related.getAttribute('tabindex'), '-1');
        const recommendations = section.getByRole('tabpanel');
        assert.ok(await recommendations.locator('li').count() > 0);
        const similarLinks = await recommendations.locator('li a').evaluateAll(links => links.map(link => link.getAttribute('href')));
        assert.ok(similarLinks.every(href => href.startsWith('/anime/')), 'Every similar card points to our own anime page');
        assert.ok(similarLinks.every(href => !relatedLinks.includes(href)), 'Known franchise works do not enter similar recommendations');
        assert.ok(similarLinks.every(href => href !== '/anime/toaru-kagaku-no-railgun'), 'The current title is excluded');
        assert.equal(await section.locator('a[href^="https:"]').count(), 0);
        await section.screenshot({ path: `/tmp/opencode/anime-similar-${theme}-${width}.png` });
        await page.keyboard.press('Home');
        await selected(related);
        assert.equal(await related.getAttribute('aria-selected'), 'true');
        if (theme === 'light') {
          const style = await related.evaluate(element => {
            const style = getComputedStyle(element);
            const line = getComputedStyle(element, '::after');
            return { background: style.backgroundImage, color: style.color, shadow: style.boxShadow, lineHeight: line.height };
          });
          assert.equal(style.background, 'none', 'No decorated button surface');
          assert.equal(style.color, 'rgb(121, 91, 46)', 'Quiet bronze active label');
          assert.equal(style.shadow, 'none');
          assert.equal(style.lineHeight, '2px');
        }
        await page.keyboard.press('End');
        await selected(similar);
        assert.equal(await similar.getAttribute('aria-selected'), 'true');
        await page.keyboard.press('ArrowRight');
        await selected(related);
        assert.equal(await related.getAttribute('aria-selected'), 'true');
        await related.blur();
        if (width < 500) {
          const rail = section.getByRole('tabpanel').locator('ul');
          const movement = await rail.evaluate(element => {
            const overflow = element.scrollWidth > element.clientWidth;
            element.scrollLeft = -element.scrollWidth;
            return { overflow, scrolled: Math.abs(element.scrollLeft) };
          });
          assert.ok(movement.overflow && movement.scrolled > 0, 'The RTL rail can be scrolled without page overflow');
          await rail.evaluate(element => { element.scrollLeft = 0; });
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No horizontal page overflow');
        await section.screenshot({ path: `/tmp/opencode/anime-connections-${theme}-${width}.png` });
        console.log('ANIME_CONNECTIONS_THEME_VIEWPORT_OK', theme, width);
      }
    }
    const checked = new Set();
    for (const href of await page.locator('#related [role=tabpanel]:not([hidden]) li a[href^="/anime/"]').evaluateAll(links => links.map(link => link.getAttribute('href')))) {
      if (checked.has(href)) continue;
      checked.add(href);
      assert.equal((await context.request.get(base + href)).status(), 200, 'Available cards resolve to an actual public page');
    }
    const reZero = [
      're-zero-kara-hajimeru-isekai-seikatsu-2nd-season',
      're-zero-kara-hajimeru-isekai-seikatsu-3rd-season',
      're-zero-kara-hajimeru-isekai-seikatsu-4th-season',
    ];
    for (const slug of reZero) {
      await page.goto(base + '/anime/' + slug + '#related', { waitUntil: 'load' });
      const links = await page.locator('#related [role=tabpanel]:not([hidden]) a').evaluateAll(links => links.map(link => link.getAttribute('href')));
      for (const other of reZero.filter(other => other !== slug)) assert.ok(links.includes('/anime/' + other), `Every verified Re:Zero season links to the other local seasons: ${slug} -> ${other}`);
      assert.ok(links.every(href => href.startsWith('/anime/')));
      console.log('REZERO_MUTUAL_LOCAL_RELATIONS_OK', slug);
    }
    assert.deepEqual(errors, []);
    console.log('VERIFIED_RELATIONS_AND_SIMILAR_BROWSER_GATE_OK');
  } catch (error) {
    await page.screenshot({ path: '/tmp/opencode/anime-connections-gate-failure.png', fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.close(); await browser.close(); }
})().catch(error => {
  console.error('CONNECTIONS_BROWSER_GATE_FAILED', String(error.stack || error.message).replace(/https?:\/\/\S+/g, '[url]'));
  process.exitCode = 1;
});
