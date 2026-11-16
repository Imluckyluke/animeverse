const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(name, deps = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(name => deps[name] ?? require(name), module, module.exports);
  return module.exports;
}
const contract = load('src/lib/download-cache-contract.ts');
const { createAutomaticDownloads, automaticDownloadUrl, startNativeDownload } = load('src/lib/automatic-download.ts', { './download-cache-contract': contract });
const now = 1800000000000;
const url = 'https://anime.bayerkashan.ir/media/' + 'a'.repeat(64) + '/' + 'b'.repeat(32) + '/1800000300/' + 'c'.repeat(64);
const item = { episode: 175, quality: '480p', status: 'uploading', provider: 'local', live: true, streamBytes: 10, bytes: 20, size: 100, url };

test('an explicit direct click automatically starts once at the first live URL, never again on ready', () => {
  const starts = [], auto = createAutomaticDownloads(url => starts.push(url), () => now);
  auto.arm('request-1', item);
  assert.equal(auto.consume('request-1', { ...item, status: 'queued', url: undefined, live: undefined, streamBytes: undefined }), false);
  assert.equal(auto.consume('request-1', item), true);
  assert.equal(auto.consume('request-1', { ...item }), false);
  assert.equal(auto.consume('request-1', { ...item, status: 'ready', live: undefined, streamBytes: undefined, bytes: 100 }), false);
  assert.deepEqual(starts, [url]);
});
test('passive polls, restored history, another item and bulk membership never arm a download', () => {
  const starts = [], auto = createAutomaticDownloads(url => starts.push(url), () => now);
  assert.equal(auto.consume('history', item), false);
  auto.arm('single', item);
  assert.equal(auto.consume('single', { ...item, episode: 174 }), false);
  assert.equal(auto.consume('single', { ...item, quality: '720p' }), false);
  assert.equal(auto.consume('bulk', item), false);
  assert.deepEqual(starts, []);
});
test('pause, removal, terminal failure and clear cancel pending automatic downloads', () => {
  const starts = [], auto = createAutomaticDownloads(url => starts.push(url), () => now);
  auto.arm('paused', item); assert.equal(auto.consume('paused', item, true), false);
  assert.equal(auto.consume('paused', item), false,'unpausing cannot revive a cancelled click');
  auto.arm('removed', item); auto.cancel('removed'); assert.equal(auto.consume('removed', item), false);
  auto.arm('failed', item); assert.equal(auto.consume('failed', { ...item, status: 'failed', live: undefined, streamBytes: undefined, url: undefined }), false);
  assert.equal(auto.consume('failed', item), false);
  auto.arm('clear', item); auto.clear(); assert.equal(auto.consume('clear', item), false);
  assert.deepEqual(starts, []);
});
test('expired or unsafe URLs are not launched and a later fresh signed URL may fulfill the intent', () => {
  const starts = [], auto = createAutomaticDownloads(url => starts.push(url), () => now);
  auto.arm('request', item);
  assert.equal(auto.consume('request', { ...item, url: url.replace('1800000300', '1799999999') }), false);
  for (const change of [{ url: 'javascript:alert(1)' }, { url: 'https://t.me/testanivers/123' }, { provider: 'telegram' }, { streamBytes: 101 }]) {
    assert.equal(automaticDownloadUrl({ ...item, ...change }, now), undefined);
  }
  assert.equal(auto.consume('request', item), true); assert.deepEqual(starts, [url]);
});
test('a cached ready file starts too; a browser-blocked attempt never loops without a new click', () => {
  let attempts = 0;
  const auto = createAutomaticDownloads(() => { attempts++; throw Error('browser blocked'); }, () => now);
  auto.arm('request', item);
  const ready = { ...item, status: 'ready', live: undefined, streamBytes: undefined, bytes: 100 };
  assert.throws(() => auto.consume('request', ready), /blocked/);
  assert.equal(auto.consume('request', ready), false);
  auto.arm('request', item); assert.throws(() => auto.consume('request', ready), /blocked/);
  assert.equal(attempts, 2);
});
test('native attachment delivery uses only a validated hidden frame, not a popup, Blob or timed removal', () => {
  const attrs = {}, frame = { style: {}, setAttribute(k, v) { attrs[k] = v; } }, children = [];
  const doc = { createElement(tag) { assert.equal(tag, 'iframe'); return frame; }, body: { appendChild(frame) { children.push(frame); } } };
  startNativeDownload(url, doc);
  assert.equal(frame.src, url); assert.equal(frame.width, '0'); assert.equal(frame.tabIndex, -1); assert.equal(attrs.referrerpolicy, 'no-referrer');
  assert.equal(children.length, 1);
  assert.throws(() => startNativeDownload('https://attacker.example/file', doc));
  assert.equal(children.length, 1);
});
test('only explicit episode/retry clicks opt in; passive query preparation and resume cannot arm', () => {
  const provider=fs.readFileSync(path.join(__dirname,'../src/components/downloads/downloads-provider.tsx'),'utf8');
  const episodes=fs.readFileSync(path.join(__dirname,'../src/components/anime/episode-list.tsx'),'utf8');
  assert.ok(provider.includes('options?.autoStart === true'));
  assert.ok(!provider.includes('options?.autoStart !== false'));
  assert.ok(episodes.includes('{ autoStart: true }'));
  assert.ok(episodes.includes('{ autoStart: false }'));
  const controls=provider.slice(provider.indexOf('const controlDownload ='),provider.indexOf('const controlAnime ='));
  assert.ok(!controls.includes('.arm('));
  assert.ok(provider.includes('Object.keys(removed.current).forEach(id => automatic.current?.cancel(id))'));
});
