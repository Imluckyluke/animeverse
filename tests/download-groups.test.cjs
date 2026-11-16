const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const contractSource = fs.readFileSync(__dirname + '/../src/lib/download-cache-contract.ts', 'utf8');
const managerSource = fs.readFileSync(__dirname + '/../src/lib/download-manager.ts', 'utf8');
function load(source, dependency) {
  const module = { exports: {} };
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'module', 'exports', js)(() => dependency, module, module.exports);
  return module.exports;
}
const model = load(managerSource, load(contractSource));
const item = (episode, job = String(episode).repeat(64).slice(0, 64)) => ({ episode, job, quality: '720p', status: 'queued', bytes: 0 });
const record = (id, changes = {}) => ({ id, slug: 'anime-one', title: 'Anime One', quality: '720p', episode: 1, all: false, createdAt: 100, updatedAt: 110, total: 1, serverId: 'a'.repeat(64), items: [item(1)], ...changes });

test('individual requests group by anime without replacing durable identities', () => {
  const rows = [record('request-one-valid-123'), record('request-two-valid-123', { episode: 2, items: [item(2)], serverId: 'b'.repeat(64) }), record('request-other-valid-1', { slug: 'anime-two', title: 'Anime Two' })];
  const original = JSON.stringify(rows);
  const groups = model.groupDownloadRecords(rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].title, 'Anime One');
  assert.deepEqual(groups[0].records.map(row => row.id), rows.slice(0, 2).map(row => row.id));
  assert.equal(JSON.stringify(rows), original);
});

test('batch and single subscriptions share one child only for the same actual job', () => {
  const bulk = record('request-bulk-valid-12', { all: true, total: 2, items: [item(1), item(2)], serverId: 'f'.repeat(64) });
  const single = record('request-one-valid-123');
  const [group] = model.groupDownloadRecords([bulk, single]);
  assert.equal(group.items.length, 2);
  assert.equal(group.items[0].references.length, 2);
  assert.equal(group.activeCount, 2);
  const revised = record('request-revised-12345', { serverId: 'c'.repeat(64), items: [item(1, 'c'.repeat(64))] });
  assert.equal(model.groupDownloadRecords([bulk, single, revised])[0].items.length, 3);
});

test('individual pause and resume override only their own batch member', () => {
  const bulk = record('request-bulk-valid-12', { all: true, total: 2, items: [item(1), item(2)], itemPaused: { '1|720p': true } });
  let group = model.groupDownloadRecords([bulk])[0];
  assert.equal(group.activeCount, 1); assert.equal(group.items[0].paused, true); assert.equal(group.items[1].paused, false);
  group = model.groupDownloadRecords([{ ...bulk, paused: true, itemPaused: { '1|720p': false } }])[0];
  assert.equal(group.activeCount, 1); assert.equal(group.items[0].paused, false); assert.equal(group.items[1].paused, true);
  assert.equal(model.groupDownloadRecords([{ ...bulk, paused: true, itemPaused: {} }])[0].activeCount, 0);
});

test('pausing one of overlapping subscriptions does not hide another active one', () => {
  const [group] = model.groupDownloadRecords([record('request-one-valid-123', { paused: true }), record('request-two-valid-123')]);
  assert.equal(group.items.length, 1); assert.equal(group.items[0].paused, false); assert.equal(group.activeCount, 1);
});

test('deleted batch children stay hidden across polls, reloads and stale cross-tab updates', () => {
  const row = record('request-bulk-valid-12', { all: true, total: 2, items: [item(1), item(2)], removedItems: { '2|720p': 200 }, updatedAt: 200 });
  const fresh = { ...row, items: model.reconcileTransfers(row.items, [item(1), item(2)]), removedItems: undefined, updatedAt: 300 };
  const [merged] = model.mergeDownloadHistory([row], [fresh]);
  assert.equal(model.groupDownloadRecords([merged])[0].items.length, 1);
  assert.equal(merged.items.length, 2);
  const [restored] = model.parseDownloadHistory(JSON.stringify(model.persistableDownloadHistory([merged])));
  assert.equal(restored.id, row.id); assert.equal(restored.serverId, row.serverId);
  assert.equal(model.groupDownloadRecords([restored])[0].items.length, 1);
  assert.equal(model.mergeDownloadHistory([fresh], [row])[0].removedItems['2|720p'], 200);
});

test('compact previews retain pause overrides and deletion tombstones for unloaded episodes', () => {
  const row = record('request-bulk-valid-12', { all: true, total: 1000, items: Array.from({ length: 1000 }, (_, n) => item(n + 1, 'd'.repeat(64))), itemPaused: { '500|720p': true }, removedItems: { '999|720p': 200 } });
  const [restored] = model.parseDownloadHistory(JSON.stringify(model.persistableDownloadHistory([row])));
  assert.equal(restored.items.length, 20); assert.equal(restored.total, 1000);
  const [group] = model.groupDownloadRecords([restored]);
  assert.equal(group.total, 999); assert.equal(group.activeCount, 998);
});

test('malformed persisted per-episode controls cannot become requests', () => {
  const row = record('request-bulk-valid-12', { all: true, control: 'other', itemPaused: { '1|720p': 'yes' }, itemControls: { '1|720p': { action: 'pause', job: 'bad' } }, removedItems: { '1|720p': 'bad' } });
  const [restored] = model.parseDownloadHistory(JSON.stringify([row]));
  assert.equal(restored.control, undefined); assert.deepEqual(restored.itemPaused, {}); assert.deepEqual(restored.itemControls, {}); assert.deepEqual(restored.removedItems, {});
});
