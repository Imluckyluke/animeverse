/* Read-only public UI QA. All preparation replies and attachments are mocked;
 * no real account, Telegram request, server job or video is created. */
const assert = require('node:assert/strict');
const { chromium } = require('/var/lib/bot-host/.npm/_npx/f0a362733743bae2/node_modules/playwright');
const base = process.env.AV_AUTOMATIC_UI_BASE || 'https://animeverse-xi.vercel.app';
const signed = 'https://anime.bayerkashan.ir/media/' + 'a'.repeat(64) + '/' + 'b'.repeat(32) + '/1800000300/' + 'c'.repeat(64);
const file = Buffer.alloc(100, 65);
(async () => {
  const browser = await chromium.launch({
    executablePath: '/var/lib/bot-host/.cache/visual-qa/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: '/tmp/opencode', LD_LIBRARY_PATH: '/var/lib/bot-host/.cache/visual-qa/sysroot/usr/lib/x86_64-linux-gnu' },
  });
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: true });
      let posts = 0, polls = 0, completed = false, downloaded = 0, firstPostAt = 0;
      const page = await context.newPage(); page.setDefaultTimeout(45000);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error'&&/frame|download/i.test(m.text()))console.log('NATIVE_BROWSER_MESSAGE',m.text().slice(0,400));});
      page.on('download', () => downloaded++);
      await context.addInitScript(()=>{
        new MutationObserver(records=>{
          for(const record of records)for(const node of record.addedNodes){
            if(node.nodeName==='IFRAME' && node.getAttribute('title')==='دانلود مستقیم فایل'){
              window.__automaticGestureExpired=!navigator.userActivation.isActive;
            }
          }
        }).observe(document,{childList:true,subtree:true});
      });
      await context.route('**/api/account/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' }));
      await context.route('**/api/link?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'done', url: 'https://t.me/testanivers/91572', size: 100 }) }));
      await context.route('**/api/download-cache*', async route => {
        if (route.request().method() === 'POST') {
          posts++;
          if(!firstPostAt)firstPostAt=Date.now();
          return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ job: 'a'.repeat(64), status: 'queued', size: 100, bytes: 0 }) });
        }
        polls++;
        const available = firstPostAt>0 && Date.now()-firstPostAt>=7000;
        const body = completed
          ? { job: 'a'.repeat(64), status: 'ready', provider: 'local', size: 100, bytes: 100, url: signed }
          : available ? { job: 'a'.repeat(64), status: 'uploading', provider: 'local', live: true, streamBytes: 10, size: 100, bytes: 20, phase: 'receiving', url: signed }
          : { job: 'a'.repeat(64), status: 'queued', size: 100, bytes: 0 };
        return route.fulfill({ status: completed ? 200 : 202, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await context.route('https://anime.bayerkashan.ir/media/**', route => route.fulfill({ status: 200, headers: {
        'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="synthetic-direct-qa.txt"',
        'Content-Length': String(file.length), 'Cache-Control': 'private, no-store',
      }, body: file }));
      const openEpisode = async () => {
        const row=page.locator('#episode-black-clover-season-2-175');
        const trigger=row.locator('button[aria-controls^="qualities-"]');
        if(await trigger.getAttribute('aria-expanded')!=='true') await trigger.click();
        await page.waitForFunction(()=>document.querySelector('#episode-black-clover-season-2-175 button[aria-controls]')?.getAttribute('aria-expanded')==='true');
      };
      await page.goto(base + '/anime/black-clover-season-2', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => document.fonts.ready);
      await openEpisode();
      const firstDownload=page.waitForEvent('download').catch(()=>null);
      await page.getByRole('button', { name: 'دانلود مستقیم قسمت ۱۷۵ با کیفیت 480p', exact: true }).click();
      const first=await firstDownload;
      if(!first){
        console.log('AUTOMATIC_DIAGNOSTIC',{posts,polls,downloaded,errors,state:await page.evaluate(()=>({url:location.href,frames:[...document.querySelectorAll('iframe')].map(e=>({title:e.title,src:e.src})),history:JSON.parse(localStorage.getItem('av_downloads_v1')||'[]').map(r=>({id:r.id,items:r.items.map(i=>({status:i.status,live:i.live,bytes:i.bytes,job:i.job}))}))}))});
        throw Error('No native download after original direct click');
      }
      assert.equal(first.suggestedFilename(),'synthetic-direct-qa.txt');
      // Do not inspect userActivation with page.evaluate before the transfer:
      // CDP evaluation itself can grant a synthetic gesture. The page's own
      // MutationObserver records it without changing browser activation.
      assert.equal(posts,1); assert.equal(downloaded,1);
      assert.equal(await page.evaluate(()=>window.__automaticGestureExpired),true,'automatic download must work after the original gesture expired');
      assert.equal(context.pages().length,1); assert.ok(page.url().includes('/anime/black-clover-season-2'));
      assert.equal(await page.getByRole('link',{name:/دانلود هم‌زمان/}).count(),0);
      completed=true;
      await page.waitForFunction(()=>[...document.querySelectorAll('[role="progressbar"]')].some(e=>e.getAttribute('aria-valuenow')==='100'));
      assert.equal(await page.locator('iframe[title="دانلود مستقیم فایل"]').count(),1);
      assert.equal(downloaded,1,'live -> ready must not start a second file');
      const historyRechecked=page.waitForResponse(response=>response.request().method()==='GET' && response.url().includes('/api/download-cache?job='));
      await page.reload({waitUntil:'domcontentloaded'});
      await historyRechecked;
      await page.evaluate(()=>document.fonts.ready);
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('av_downloads_v1')||'[]').some(r=>r.items.some(i=>i.status==='ready')));
      assert.equal(await page.locator('iframe[title="دانلود مستقیم فایل"]').count(),0);
      assert.equal(downloaded,1,'history reload must never auto-download');
      await openEpisode();
      const explicitAgain=page.waitForEvent('download').catch(()=>null);
      await page.getByRole('button',{name:'دانلود مستقیم قسمت ۱۷۵ با کیفیت 480p',exact:true}).click();
      assert.ok(await explicitAgain,'a new explicit click must start the cached native file');
      assert.equal(downloaded,2);assert.equal(posts,1,'a repeat click reuses the same prepared job');
      assert.deepEqual(errors,[]);
      console.log('AUTOMATIC_DIRECT_UI_OK',width,'single click/delayed native download/no ready replay/no reload replay');
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error('AUTOMATIC_DIRECT_UI_FAILED',error.stack||error.message);process.exitCode=1;});
