const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(name, dependencies = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(name => dependencies[name] ?? require(name), module, module.exports);
  return module.exports;
}
const contract = load('src/lib/download-cache-contract.ts');
const model = load('src/lib/download-manager.ts', { './download-cache-contract': contract });
const item = { episode: 1, quality: '720p', status: 'uploading', size: 10000, bytes: 1234 };
test('percentage reflects actual bytes with a decimal and waits for verified readiness', () => {
  assert.equal(model.progressPercent(item), 12.3);
  assert.equal(model.progressPercent({ ...item, bytes: 10000, phase: 'verifying' }), 99.9);
  assert.equal(model.progressPercent({ ...item, status: 'ready' }), 100);
  assert.equal(model.progressPercent({ ...item, status: 'queued', bytes: 0 }), 0);
});
test('unknown sizes and invalid byte counts cannot produce invented or NaN progress', () => {
  for (const size of [undefined, 0, NaN, Infinity]) assert.equal(model.progressPercent({ ...item, size }), 0);
  for (const bytes of [NaN, Infinity, -10]) assert.equal(model.progressPercent({ ...item, bytes }), 0);
});
test('live phase and speed changes are reconciled without discarding server telemetry', () => {
  const before = [{ ...item, phase: 'metadata', speed: 0, queueAhead: 1 }];
  const incoming = [{ ...item, phase: 'receiving', speed: 123456, queueAhead: 0, etaSeconds: 7 }];
  const result = model.reconcileTransfers(before, incoming);
  assert.equal(result[0].phase, 'receiving');
  assert.equal(result[0].speed, 123456);
  assert.equal(result[0].queueAhead, 0);
  assert.equal(model.reconcileTransfers(result, incoming), result);
});
test('progressive delivery replaces direct download without a separate mode button', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/downloads/download-center.tsx'), 'utf8');
  assert.ok(source.includes('const directAvailable = ready || live && !paused;'));
  assert.ok(!source.includes('دانلود هم‌زمان'));
  assert.ok(source.includes('دانلود مستقیم'));
  assert.ok(source.includes('href={item.url} download'));
  assert.ok(source.includes('پیشرفت آماده‌سازی سرور'));
  assert.ok(source.includes('نه پیشرفت دانلود روی گوشی'));
  assert.ok(!source.includes('new Blob'));
  assert.ok(!source.includes('fetch(item.url'));
  const provider=fs.readFileSync(path.join(__dirname,'../src/components/downloads/downloads-provider.tsx'),'utf8');
  assert.ok(provider.includes('automatic.current?.arm'));
  assert.ok(provider.includes('handoffDownload(row.id, items)'));
  const episodes=fs.readFileSync(path.join(__dirname,'../src/components/anime/episode-list.tsx'),'utf8');
  assert.ok(episodes.includes('{ autoStart: false }'));
});
