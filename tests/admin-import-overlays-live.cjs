/*
 * Live overlay/import gate for the admin console.
 *
 * Reads { base, token } from stdin. The token is a one-use owner grant; it is
 * redeemed once and never printed. All admin mutations are intercepted and
 * aborted except read-only GET/HEAD traffic and the single post-preview POST.
 * The only account calls made are the grant redemption and this browser
 * context's own logout.
 *
 * Required run:
 *   printf '%s' '{"base":"https://…","token":"…"}' | node tests/admin-import-overlays-live.cjs
 */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('/var/lib/bot-host/.npm/_npx/f0a362733743bae2/node_modules/playwright');

const PREVIEW_SHOT = '/tmp/opencode/admin-aniplus-post-preview.png';
const IMPORT_HEADING = 'استخراج از انی\u200cپلاس';
const MOBILE_ADMIN_NAV = /ناوبری بخش/;
const REVIEW_TAB = /^بررسی فایل/;

let secret = '';

function redact(value) {
  let text = String(value == null ? '' : value);
  if (secret) text = text.split(secret).join('[redacted]');
  return text.replace(/https?:\/\/\S+/g, '[url]');
}

(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  assert.equal(typeof input.base, 'string', 'base is required');
  assert.equal(typeof input.token, 'string', 'token is required');
  assert.ok(input.token.length > 0, 'token is required');
  secret = input.token;

  const parsedBase = new URL(input.base);
  const origin = parsedBase.origin;
  const base = origin + parsedBase.pathname.replace(/\/+$/, '');
  const previewRequests = [];
  const confirmRequests = [];
  const confirmAttempts = [];
  const blockedMutations = [];
  let browser = null;
  let context = null;

  try {
    browser = await chromium.launch({
      executablePath: '/var/lib/bot-host/.cache/visual-qa/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
      args: ['--no-sandbox'],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: '/tmp/opencode', LD_LIBRARY_PATH: '/tmp/opencode/animeverse-admin-browser-libs/lib' },
    });
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });

    // Defence in depth: only reads, the one preview POST, and this context's
    // own logout can reach the control service. Anything else is aborted and
    // fails the run, so an accidental click cannot mutate live data.
    await context.route('**/api/admin/**', async (route) => {
      const request = route.request();
      const method = request.method().toUpperCase();
      const path = new URL(request.url()).pathname.replace(/\/+$/, '');
      if (method === 'GET' || method === 'HEAD') return route.continue();
      if (method === 'POST' && path === '/api/admin/imports/preview') {
        previewRequests.push('preview');
        return route.continue();
      }
      if (method === 'DELETE' && path === '/api/admin/session') return route.continue();
      if (path.endsWith('/confirm')) confirmAttempts.push(`${method} ${path}`);
      blockedMutations.push(`${method} ${path}`);
      return route.abort();
    });
    await context.route('**/api/account/**', async (route) => {
      const request = route.request();
      const method = request.method().toUpperCase();
      const path = new URL(request.url()).pathname.replace(/\/+$/, '');
      if (method === 'GET' || method === 'HEAD') return route.continue();
      if (method === 'POST' && path === '/api/account/access') return route.continue();
      if (method === 'DELETE' && path === '/api/account/session') return route.continue();
      blockedMutations.push(`${method} ${path}`);
      return route.abort();
    });

    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.name));
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/confirm')) confirmRequests.push(request.method());
    });

    const access = await context.request.post(base + '/api/account/access', {
      headers: { Origin: origin },
      data: { token: input.token },
      timeout: 20000,
    });
    assert.equal(access.status(), 200, 'owner test grant redemption');
    input.token = '';

    await page.goto(base + '/admin', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('heading', { name: 'نمای کلی', exact: true }).waitFor();

    const mobileAdminNav = page.getByRole('navigation', { name: MOBILE_ADMIN_NAV });

    async function setTheme(theme) {
      await page.evaluate((next) => {
        localStorage.setItem('av_theme', next);
        document.documentElement.dataset.theme = next;
        window.dispatchEvent(new Event('av-theme'));
      }, theme);
      await page.waitForFunction((next) => {
        const root = document.querySelector('.av-root');
        return document.documentElement.dataset.theme === next && root &&
          getComputedStyle(root).color === (next === 'light' ? 'rgb(42, 39, 34)' : 'rgb(245, 247, 255)');
      }, theme);
    }

    async function openTab(name) {
      await mobileAdminNav.getByRole('button', { name }).click();
      await page.getByRole('heading', { name }).first().waitFor();
    }

    async function ensureMobileDockVisible() {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() => {
        const dock = document.querySelector('nav.mobile-dock');
        if (!dock) return false;
        const box = dock.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight + 1;
      });
    }

    async function activate(locator) {
      await locator.evaluate((element) => element.focus({ preventScroll: true }));
      await page.keyboard.press('Enter');
    }

    async function assertOverlayAboveDock(title) {
      const dialog = page.getByRole('dialog', {
        name: title,
        ...(typeof title === 'string' ? { exact: true } : {}),
      });
      await dialog.waitFor({ state: 'visible' });
      const geometry = await page.evaluate(() => {
        const overlay = document.querySelector('[data-console-overlay]');
        const dock = document.querySelector('nav.mobile-dock');
        const main = document.querySelector('main');
        if (!overlay || !dock || !main) return null;
        const box = dock.getBoundingClientRect();
        const x = Math.min(innerWidth - 1, Math.max(0, box.left + box.width / 2));
        const y = Math.min(innerHeight - 1, Math.max(0, box.top + box.height / 2));
        const hit = document.elementFromPoint(x, y);
        return {
          overlayParentIsBody: overlay.parentElement === document.body,
          overlayInsideMain: main.contains(overlay),
          overlayPosition: getComputedStyle(overlay).position,
          overlayZ: Number(getComputedStyle(overlay).zIndex),
          mainZ: Number(getComputedStyle(main).zIndex),
          dockZ: Number(getComputedStyle(dock).zIndex),
          dockVisible: box.top >= 0 && box.bottom <= innerHeight + 1,
          hitInsideOverlay: Boolean(hit && overlay.contains(hit)),
          hitInsideDock: Boolean(hit && dock.contains(hit)),
          hitTag: hit ? hit.tagName : '',
          hitClass: hit && typeof hit.className === 'string' ? hit.className : '',
        };
      });
      assert.ok(geometry, 'dialog overlay and mobile dock must both exist');
      assert.equal(geometry.overlayParentIsBody, true, 'dialog must portal to document.body');
      assert.equal(geometry.overlayInsideMain, false, 'dialog must escape the <main> stacking context');
      assert.equal(geometry.overlayPosition, 'fixed');
      assert.ok(geometry.dockVisible, 'mobile dock must be in the viewport during the overlap check');
      assert.ok(geometry.overlayZ > geometry.dockZ, 'dialog layer must beat the mobile dock');
      assert.ok(geometry.overlayZ > geometry.mainZ, 'dialog layer must beat the main stacking context');
      assert.equal(geometry.hitInsideDock, false, `dock must not win hit-testing (hit ${geometry.hitTag}.${geometry.hitClass})`);
      assert.equal(geometry.hitInsideOverlay, true, 'overlay/backdrop must win hit-testing over the dock');
      return dialog;
    }

    async function closeWithEscape(dialog) {
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await page.getByRole('dialog').count(), 0);
    }

    async function assertCatalogSheet() {
      await openTab(/^انیمه/);
      const editButton = page.getByRole('button', { name: /^ویرایش / }).first();
      await editButton.waitFor({ state: 'visible' });
      const openerLabel = await editButton.getAttribute('aria-label');
      assert.ok(openerLabel && openerLabel.startsWith('ویرایش '), 'first catalog action must be an edit control');

      await ensureMobileDockVisible();
      await activate(editButton);
      const dialog = await assertOverlayAboveDock('ویرایش عنوان');
      await dialog.getByText('اطلاعات تحریریه', { exact: true }).waitFor();

      const body = dialog.locator('.av-dialog-body');
      const save = dialog.getByRole('button', { name: 'ذخیره', exact: true });
      const note = dialog.getByPlaceholder('مثلاً: اصلاح عنوان و ژانر');
      await save.waitFor({ state: 'visible' });
      await note.waitFor({ state: 'visible' });

      const metrics = await body.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      assert.ok(metrics.scrollHeight > metrics.clientHeight, 'catalog sheet body must be scrollable on mobile');
      const scrollTop = await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return element.scrollTop;
      });
      assert.ok(scrollTop > 0, 'catalog sheet body must scroll to its end');

      const viewport = page.viewportSize();
      const box = await save.boundingBox();
      assert.ok(box, 'catalog footer save button must have geometry');
      assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1, 'catalog footer must remain inside the viewport');
      assert.equal(await save.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        // An unchanged form intentionally disables Save with pointer-events:none.
        // Its own footer may win hit-testing, but neither the dock nor another
        // layer may cover that same point. Do not mutate data to enable Save.
        return hit === element || element.contains(hit) || Boolean(element.disabled && hit?.contains(element)
          && hit.closest('[data-console-overlay]') === element.closest('[data-console-overlay]'));
      }), true, 'catalog footer must not be covered even when Save is intentionally disabled');
      assert.equal(await note.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === element;
      }), true, 'catalog footer note field must remain interactive');

      await closeWithEscape(dialog);
      await page.waitForFunction((label) => document.activeElement?.getAttribute('aria-label') === label, openerLabel);
    }

    async function assertPublishConfirmation() {
      await ensureMobileDockVisible();
      const trigger = page.getByRole('button', { name: 'انتشار', exact: true });
      await trigger.waitFor({ state: 'visible' });
      assert.equal(await trigger.isEnabled(), true, 'publish trigger must be available to the owner');
      await activate(trigger);
      const dialog = await assertOverlayAboveDock('ثبت فرمان انتشار');
      const confirm = dialog.getByRole('button', { name: 'ثبت فرمان', exact: true });
      await confirm.waitFor({ state: 'visible' });
      assert.equal(await confirm.isEnabled(), true);
      await closeWithEscape(dialog);
    }

    async function assertUserCreateSheet() {
      await openTab(/^کاربران$/);
      await ensureMobileDockVisible();
      const trigger = page.getByRole('button', { name: 'حساب کارمند', exact: true });
      await trigger.waitFor({ state: 'visible' });
      await activate(trigger);
      const dialog = await assertOverlayAboveDock('ساخت حساب کارمند');
      const submit = dialog.getByRole('button', { name: 'ساخت حساب', exact: true });
      await submit.waitFor({ state: 'visible' });
      assert.equal(await submit.isEnabled(), true);
      await closeWithEscape(dialog);
    }

    async function assertPostPreviewAndModeConfirm(theme, previewAlreadyDone) {
      await openTab(/^تنظیمات$/);
      const importHeading = page.getByRole('heading', { name: IMPORT_HEADING, exact: true });
      await importHeading.waitFor({ state: 'visible' });
      const urlInput = page.getByPlaceholder('https://t.me/aniplus/33121', { exact: true });
      await urlInput.waitFor({ state: 'visible' });

      const placement = await page.evaluate((heading) => {
        const titles = Array.from(document.querySelectorAll('h2'));
        const post = titles.find((element) => element.textContent?.trim() === heading);
        const mode = titles.find((element) => element.textContent?.trim() === 'حالت انتشار');
        const card = post?.closest('.av-card');
        return {
          beforeMode: Boolean(post && mode && (post.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING)),
          firstCard: Boolean(card && card.parentElement?.firstElementChild === card),
        };
      }, IMPORT_HEADING);
      assert.equal(placement.beforeMode, true, 'imports panel must precede publication mode');
      assert.equal(placement.firstCard, true, 'imports panel must be mounted at the beginning of Settings');

      if (theme === 'light' && !previewAlreadyDone) {
        await urlInput.fill('https://t.me/aniplus/33121');
        const inspect = page.getByRole('button', { name: /^بررسی لینک و نمایش نمونه/ });
        await inspect.click();
        const cards = page.locator('[data-testid="post-page-preview"]');
        await cards.first().waitFor({ state: 'visible', timeout: 120000 });
        const confirm = page.getByRole('button', { name: /^تأیید نمونه و شروع دریافت فایل/ });
        await confirm.waitFor({ state: 'visible', timeout: 30000 });
        assert.equal(await confirm.isEnabled(), true, 'post preview confirmation must be available after a ready preview');
        assert.equal(previewRequests.length, 1, 'exactly one post-preview request must be sent');
        assert.deepEqual(confirmRequests, [], 'no post-import confirm request may be sent');
        assert.deepEqual(confirmAttempts, [], 'no post-import confirm may even be attempted');

        fs.mkdirSync('/tmp/opencode', { recursive: true });
        const panel = page.locator('section.av-card').filter({
          has: page.getByRole('heading', { name: IMPORT_HEADING, exact: true }),
        }).first();
        await panel.screenshot({ path: PREVIEW_SHOT });
        await page.getByRole('button', { name: 'انصراف؛ بدون دریافت', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('[data-testid="post-page-preview"]'));
        previewAlreadyDone = true;
      }

      const checkedMode = page.locator('input[name="publication-mode"]:checked');
      await checkedMode.waitFor({ state: 'attached' });
      const currentMode = await checkedMode.getAttribute('value');
      assert.ok(currentMode === 'manual' || currentMode === 'automatic', 'publication mode must be readable');
      const nextMode = currentMode === 'automatic' ? 'manual' : 'automatic';
      await page.locator(`input[name="publication-mode"][value="${nextMode}"]`).check();

      const saveMode = page.getByRole('button', { name: /^ذخیرهٔ حالت انتشار$/ });
      await saveMode.waitFor({ state: 'visible' });
      assert.equal(await saveMode.isEnabled(), true, 'publication mode save must be enabled after a local change');
      await ensureMobileDockVisible();
      await activate(saveMode);
      const dialog = await assertOverlayAboveDock('تغییر حالت انتشار');
      const confirmSave = dialog.getByRole('button', { name: /^ذخیرهٔ تغییر$/ });
      await confirmSave.waitFor({ state: 'visible' });
      assert.equal(await confirmSave.isEnabled(), true);
      await closeWithEscape(dialog);
      return previewAlreadyDone;
    }

    async function assertReviewSheet() {
      await openTab(REVIEW_TAB);
      const trigger = page.getByRole('button', { name: 'بررسی و اتصال', exact: true }).first();
      const empty = page.getByText('موردی برای بازبینی نیست', { exact: true });
      await trigger.or(empty).first().waitFor({ state: 'visible' });
      if (await trigger.count() === 0) {
        console.log('REVIEW_FILE_SHEET_SKIPPED_NO_ITEMS');
        return;
      }
      await ensureMobileDockVisible();
      await activate(trigger);
      const dialog = await assertOverlayAboveDock(/^پیش\u200cنمایش و اتصال فایل$/);
      const preview = dialog.getByRole('button', { name: /^پیش\u200cنمایش$/ });
      await preview.waitFor({ state: 'visible' });
      assert.equal(await dialog.getByRole('button', { name: /^تأیید و ثبت در صف/ }).count(), 0, 'review sheet must not expose apply before a preview');
      await closeWithEscape(dialog);
    }

    let previewDone = false;
    for (const theme of ['light', 'dark']) {
      console.log('ADMIN_IMPORT_OVERLAYS_THEME_START', theme);
      await setTheme(theme);
      await assertCatalogSheet();
      await assertPublishConfirmation();
      await assertUserCreateSheet();
      previewDone = await assertPostPreviewAndModeConfirm(theme, previewDone);
      await assertReviewSheet();
      console.log('ADMIN_IMPORT_OVERLAYS_THEME_OK', theme);
    }

    assert.equal(previewDone, true, 'the read-only post preview must complete once');
    assert.equal(previewRequests.length, 1, 'only the single allowed post-preview POST may reach the service');
    assert.deepEqual(confirmRequests, [], 'no post-import confirm request may be sent during the run');
    assert.deepEqual(confirmAttempts, [], 'no post-import confirm may even be attempted during the run');
    assert.deepEqual(blockedMutations, [], 'no unexpected admin/account mutation may be attempted');
    assert.deepEqual(pageErrors, [], 'the admin pages must not raise browser errors');

    assert.equal((await context.request.get(base + '/api/admin/session')).status(), 200, 'owner session must be active before logout');
    const accountResponse = await context.request.get(base + '/api/account/session');
    assert.equal(accountResponse.status(), 200);
    const account = await accountResponse.json();
    assert.ok(account.csrf, 'session CSRF must be available for this context only');
    const logout = await context.request.delete(base + '/api/account/session', {
      headers: { Origin: origin, 'X-CSRF-Token': account.csrf },
    });
    assert.equal(logout.status(), 200, 'own temporary session logout');
    assert.equal((await context.request.get(base + '/api/admin/session')).status(), 404, 'admin session must be gone after logout');

    const probeId = '0'.repeat(32);
    for (const path of [
      `/api/admin/imports/${probeId}`,
      `/api/admin/imports/${probeId}/confirm`,
      '/api/admin/imports/preview',
    ]) {
      const response = await context.request.get(base + path);
      assert.ok(
        [401, 403, 404, 405].includes(response.status()),
        `unauthenticated imports path must be rejected (${path}): ${response.status()}`,
      );
    }

    const remainingCookies = await context.cookies();
    assert.equal(
      remainingCookies.some((cookie) => /av_(account|admin)_session$/.test(cookie.name)),
      false,
      'logout must clear this context session cookies',
    );

    console.log('ADMIN_IMPORT_OVERLAYS_LIVE_OK');
  } finally {
    if (context) {
      try {
        const session = await context.request.get(base + '/api/account/session');
        if (session.ok()) {
          const payload = await session.json();
          if (payload.csrf) {
            await context.request.delete(base + '/api/account/session', {
              headers: { Origin: origin, 'X-CSRF-Token': payload.csrf },
            });
          }
        }
      } catch { /* Cleanup is restricted to this browser's temporary test session. */ }
      await context.close();
    }
    if (browser) await browser.close();
  }
})().catch((error) => {
  console.error('ADMIN_IMPORT_OVERLAYS_BROWSER_FAILED', redact(error && error.message));
  process.exitCode = 1;
});
