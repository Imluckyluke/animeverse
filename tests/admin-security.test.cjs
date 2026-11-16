const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const input = fs.readFileSync(path.join(__dirname, '../src/lib/admin-security.ts'), 'utf8');
const compiled = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const context = { exports: {}, require, URL, Buffer, Date };
vm.runInNewContext(compiled, context);
const { sameAdminOrigin, validControlPath, verifiedAdminOrigin } = context.exports;

test('admin mutations require an exact, credential-free browser origin', () => {
  const base = 'https://animeverse-xi.vercel.app/api/admin/session';
  assert.equal(sameAdminOrigin(base, 'https://animeverse-xi.vercel.app'), true);
  assert.equal(sameAdminOrigin(base, 'https://animeverse-xi.vercel.app:443'), true);
  for (const origin of [null, '', 'null', 'http://animeverse-xi.vercel.app', 'https://animeverse-xi.vercel.app.evil.test', 'https://user@animeverse-xi.vercel.app', 'https://animeverse-xi.vercel.app/path', 'https://animeverse-xi.vercel.app?x=1']) {
    assert.equal(sameAdminOrigin(base, origin), false, String(origin));
  }
});

test('control routes cannot become arbitrary filesystem or network proxies', () => {
  for (const value of ['/overview', '/catalog/monster', '/review/preview', '/history/12/undo', '/media/' + 'a'.repeat(64) + '.webp']) assert.equal(validControlPath(value), true);
  for (const value of ['/../secret', '//evil.test', '/catalog/a/../../session', '/catalog/%2e%2e', '/shell', '/sync', '/media/foo.svg', '/catalog/__proto__']) assert.equal(validControlPath(value), false);
  assert.equal(validControlPath('/preferences', true), true);
  assert.equal(validControlPath('/overview', true), false);
});

test('discovery signatures are required, fresh and restricted to HTTPS tunnel origins', () => {
  const secret = 'test-only-not-a-live-secret';
  const updatedAt = new Date().toISOString();
  const sign = origin => ({ version: 1, origin, updatedAt, signature: crypto.createHmac('sha256', secret).update('1\n' + origin + '\n' + updatedAt).digest('hex') });
  const origin = 'https://example-safe-origin.trycloudflare.com';
  assert.equal(verifiedAdminOrigin(sign(origin), secret), origin);
  assert.throws(() => verifiedAdminOrigin({ ...sign(origin), origin: 'https://evil.test' }, secret));
  assert.throws(() => verifiedAdminOrigin(sign('https://evil.test'), secret));
  assert.throws(() => verifiedAdminOrigin(sign('http://example-safe-origin.trycloudflare.com'), secret));
  assert.throws(() => verifiedAdminOrigin(sign(origin + '/redirect'), secret));
  assert.throws(() => verifiedAdminOrigin(sign(origin), secret, Date.now() + 37 * 3600_000));
});
