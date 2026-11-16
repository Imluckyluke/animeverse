const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function worker() {
  const listeners = {};
  const deleted = [];
  const cached = [];
  const sandbox = {
    URL,
    self: {
      location: new URL('https://example.test/sw.js'),
      clients: { claim: async () => {} },
      addEventListener: (name, handler) => { listeners[name] = handler; },
    },
    caches: {
      keys: async () => ['another-app', 'animeverse-shell-v4', 'animeverse-shell-v5', 'animeverse-shell-v6-local-media'],
      delete: async key => { deleted.push(key); },
      open: async () => ({
        put: async request => { cached.push(request.url); },
        keys: async () => [],
      }),
      match: async () => undefined,
    },
    fetch: async () => ({ ok: true, type: 'basic', clone: () => ({}) }),
  };
  vm.runInNewContext(fs.readFileSync(__dirname + '/../public/sw.js', 'utf8'), sandbox);
  return { listeners, deleted, cached };
}

test('private navigations and APIs bypass the service worker', () => {
  const { listeners } = worker();
  for (const path of ['/api', '/api/account/session', '/admin', '/admin/users', '/account/access', '/login', '/favorites', '/media', '/media/signed-download']) {
    let intercepted = false;
    listeners.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://example.test' + path }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, path);
  }
});

test('activation preserves caches owned by other applications', async () => {
  const { listeners, deleted } = worker();
  let pending;
  listeners.activate({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.deepEqual(deleted, ['animeverse-shell-v4', 'animeverse-shell-v5']);
});

test('public navigation remains network-first and cacheable', async () => {
  const { listeners, cached } = worker();
  let response;
  listeners.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://example.test/browse' }, respondWith: promise => { response = promise; } });
  assert.equal((await response).ok, true);
  await new Promise(setImmediate);
  assert.deepEqual(cached, ['https://example.test/browse']);
});
