/** Offline only: Chromium shapes Persian/RTL text correctly before publication.
 * Run with Playwright available; production serves the generated static PNG.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const ROOT = path.join(__dirname, "..");
const OUTPUT = path.join(ROOT, "src/app/opengraph-image.png");
const font = fs.readFileSync(path.join(ROOT, "src/app/fonts/Vazirmatn.woff2")).toString("base64");
const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><style>
@font-face{font-family:Vazirmatn;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900;font-display:block}
*{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{font-family:Vazirmatn,Tahoma,sans-serif;color:#fff;background:#060609}
.card{position:relative;isolation:isolate;width:1200px;height:630px;padding:60px 76px;display:flex;flex-direction:column;background:radial-gradient(ellipse at 94% 4%,rgba(255,192,55,.19),transparent 57%),radial-gradient(ellipse at 0% 100%,rgba(106,84,195,.16),transparent 55%)}
.glass{position:absolute;z-index:-1;inset:28px;border:1px solid rgba(255,255,255,.1);border-radius:36px;background:linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.01));box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
header{display:flex;align-items:center;gap:16px;direction:ltr}
.logo{display:grid;place-items:center;width:58px;height:58px;border-radius:18px;background:linear-gradient(140deg,#ffda5c,#ffad3b);color:#241707;font-size:27px;font-weight:900}
.brand{font-size:20px;letter-spacing:3px;font-weight:700;color:rgba(255,255,255,.65)}
main{margin-top:auto;margin-bottom:auto;text-align:right;direction:rtl}
h1{font-size:100px;font-weight:900;line-height:1.5;letter-spacing:-2px;margin:0}
p{margin:8px 0 0;font-size:32px;line-height:1.8;font-weight:500;color:rgba(255,255,255,.75)}
footer{display:flex;align-items:center;justify-content:space-between;border-top:1px solid rgba(255,255,255,.12);padding-top:23px;font-size:21px;line-height:1.8;color:rgba(255,255,255,.56)}
.accent{display:flex;align-items:center;gap:10px;color:#f6d58a;font-size:20px}
.dot{width:7px;height:7px;border-radius:50%;background:#eabe65;box-shadow:0 0 16px rgba(234,190,101,.35)}
</style></head><body><article class="card"><div class="glass"></div>
<header><span class="logo">AV</span><span class="brand">ANIMEVERSE</span></header>
<main><h1>انیمه‌ورس</h1><p>آرشیو انیمه با زیرنویس فارسی</p></main>
<footer><span>سریال، فیلم و انیمه‌های چینی</span><span class="accent"><span class="dot"></span>کشف و دانلود انیمه</span></footer>
</article></body></html>`;

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const valid = await page.evaluate(() => document.fonts.check('900 100px "Vazirmatn"') && document.documentElement.scrollWidth === 1200 && document.documentElement.scrollHeight === 630);
    if (!valid) throw new Error("Social-card font or dimensions are invalid");
    await page.screenshot({ path: OUTPUT, type: "png", animations: "disabled" });
    console.log("Static Persian social card generated (1200 × 630).");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
