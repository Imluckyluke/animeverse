const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(relative, deps = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => deps[name] || require(name), module, module.exports);
  return module.exports;
}
const library = load('src/lib/library.ts');
const client = load('src/lib/account-client.ts', { '@/lib/library': library });
const legacy = load('src/lib/legacy-account.ts', { './account-client': client });

test('only valid bounded preference operations are accepted', () => {
  const id = 'a'.repeat(32);
  assert.equal(client.sanitizeOperation({ id, type: 'favorite', slug: 'example', value: true }).value, true);
  for (const op of [{ id: 'bad', type: 'favorite', slug: 'example', value: true },
    { id, type: 'favorite', slug: '../escape', value: true }, { id, type: 'watched', slug: 'example', episode: 0, value: true },
    { id, type: 'watched', slug: 'example', episode: 10000, value: true }]) assert.equal(client.sanitizeOperation(op), null);
});

test('pending operations merge by key rather than replacing other device preferences', () => {
  const base = { favorites: ['other'], watched: { other: [2] }, library: { other: 'watching' } };
  const result = client.applyOperations(base, [{ id: 'a'.repeat(32), type: 'favorite', slug: 'example', value: true }]);
  assert.deepEqual(new Set(result.favorites), new Set(['other', 'example']));
  assert.deepEqual(result.watched, { other: [2] });
  assert.deepEqual(base.favorites, ['other']);
});

test('session responses cannot substitute an email for a real server identity', async () => {
  const previous = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ user: { email: 'owner@example.test', name: 'Owner' }, csrf: 'a'.repeat(32) }), { status: 200 });
  try { await assert.rejects(() => client.getSession(), /نشست سرور/); }
  finally { global.fetch = previous; }
});

test('logout CSRF failure must not be reported as a cleared cookie', async () => {
  const previous = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ error: 'CSRF rejected' }), { status: 403 });
  try { await assert.rejects(() => client.logoutAccount('wrong-csrf'), /CSRF rejected/); }
  finally { global.fetch = previous; }
});

test('account copy and privacy disclose server storage without promising cloud download history', () => {
  const auth = fs.readFileSync(path.join(__dirname, '../src/components/auth-view.tsx'), 'utf8');
  const privacy = fs.readFileSync(path.join(__dirname, '../src/app/privacy/page.tsx'), 'utf8');
  assert.doesNotMatch(auth, /روی سرور ساخته نمی‌شوند/);
  assert.doesNotMatch(auth, /هش‌های ذخیره‌شده منتقل نمی‌شوند|این ورود محلی است|اطلاعات حساب قبلی روی همین دستگاه/);
  assert.match(privacy, /حساب‌های محلی نسخهٔ قبلی خودکار به حساب سرور تبدیل نمی‌شوند/);
  assert.match(privacy, /فهرست دانلودها و شناسه‌های بازیابی روی همین مرورگر ذخیره می‌شوند/);
  assert.match(privacy, /HttpOnly/);
});

test('six-character legacy passwords restore only a local identity, never a staff role', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const previousWindow = global.window, previousStorage = global.localStorage;
  global.window = { localStorage: storage }; global.localStorage = storage;
  try {
    const salt = 'test-salt';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':abc123'));
    const hash = Buffer.from(digest).toString('hex');
    storage.setItem('av_accounts', JSON.stringify([{ name: 'Legacy', email: 'legacy@example.test', salt, hash, role: 'owner' }]));
    assert.equal(await legacy.verifyLegacyAccount('legacy@example.test', 'wrong1'), null);
    const user = await legacy.verifyLegacyAccount('legacy@example.test', 'abc123');
    assert.equal(user.localOnly, true); assert.equal(user.role, 'user'); assert.equal(user.id, undefined);
    assert.equal(legacy.readLegacySession().role, 'user');
    legacy.clearLegacySession(); assert.equal(legacy.readLegacySession(), null);
    assert.ok(storage.getItem('av_accounts').includes(hash), 'old account must remain untouched');
  } finally { global.window = previousWindow; global.localStorage = previousStorage; }
});

test('guest navigation and saved download launcher do not expose personal sections', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  assert.match(read('components/header.tsx'), /user \? NAV : NAV\.filter/);
  assert.match(read('components/mobile-nav.tsx'), /ITEMS\.filter\(item => user \|\| item\.href !== "\/favorites"\)/);
  assert.match(read('components/downloads/download-center.tsx'), /user && activeCount > 0/);
  assert.match(read('components/favorites-view.tsx'), /if \(ready && !user\) return/);
});
