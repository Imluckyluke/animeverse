const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../src/lib/admin-client.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const calls = [];
let fakeResponse = { ok: true, status: 200, body: {} };

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}

function fakeFetch(url, init) {
  calls.push({ url: String(url), init });
  if (typeof fakeResponse === "function") return Promise.resolve(fakeResponse(url, init));
  return Promise.resolve(response(fakeResponse.status, fakeResponse.body));
}

const sessionData = new Map();
const windowMock = {
  sessionStorage: {
    getItem: (key) => (sessionData.has(key) ? sessionData.get(key) : null),
    setItem: (key, value) => sessionData.set(key, String(value)),
    removeItem: (key) => sessionData.delete(key),
  },
};

const context = {
  exports: {},
  module: { exports: {} },
  require,
  fetch: fakeFetch,
  Headers: globalThis.Headers,
  URLSearchParams: globalThis.URLSearchParams,
  AbortController: globalThis.AbortController,
  window: windowMock,
  console,
};
vm.runInNewContext(compiled, context);
const client = context.exports;

function reset(body = {}) {
  calls.length = 0;
  fakeResponse = { ok: true, status: 200, body };
  sessionData.clear();
}

test("post preview and confirmation are separate authenticated mutations", async () => {
  reset({ id: "a".repeat(32), state: "preview_pending" });
  await client.previewPosts({ url: "https://t.me/aniplus/33121" }, "csrf-test");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/admin/imports/preview");
  assert.equal(calls[0].init.headers.get("X-CSRF-Token"), "csrf-test");
  assert.equal(JSON.parse(calls[0].init.body).url, "https://t.me/aniplus/33121");
  await client.getPostPreview("a".repeat(32));
  assert.equal(calls[1].init.method, undefined);
  await client.confirmPostImport("a".repeat(32), "csrf-test");
  assert.equal(calls[2].url, "/api/admin/imports/" + "a".repeat(32) + "/confirm");
  assert.deepEqual(JSON.parse(calls[2].init.body), { confirm: true });
  assert.equal(calls[2].init.headers.get("X-CSRF-Token"), "csrf-test");
});

test("catalog reads are same-origin, uncached and paged", async () => {
  reset({ items: [], total: 0, page: 2, pageSize: 20 });
  await client.getCatalog({ query: "  gundam  ", page: 2, filter: "hidden" });
  const [call] = calls;
  assert.equal(call.url, "/api/admin/catalog?query=gundam&page=2&filter=hidden");
  assert.equal(call.init.method, undefined);
  assert.equal(call.init.credentials, "same-origin");
  assert.equal(call.init.cache, "no-store");
  assert.equal(call.init.headers.get("Accept"), "application/json");
  assert.equal(call.init.headers.has("X-CSRF-Token"), false);
});

test("catalog query omits empty values and encodes the target flag", async () => {
  reset({ items: [], total: 0, page: 1, pageSize: 20 });
  await client.getCatalog({ query: "   ", page: 1, filter: "all", targets: true });
  assert.equal(calls[0].url, "/api/admin/catalog?page=1&filter=all&targets=1");
});

test("mutations send JSON plus the CSRF token", async () => {
  reset({ ok: true, revision: 4 });
  const result = await client.patchTitle(
    "a b/c",
    { expectedRevision: 3, patch: { title: "جدید" }, note: "یادداشت" },
    "csrf-token",
  );
  assert.equal(result.ok, true);
  assert.equal(result.revision, 4);
  const [call] = calls;
  assert.equal(call.url, "/api/admin/catalog/a%20b%2Fc");
  assert.equal(call.init.method, "PATCH");
  assert.equal(call.init.headers.get("Content-Type"), "application/json");
  assert.equal(call.init.headers.get("X-CSRF-Token"), "csrf-token");
  assert.deepEqual(JSON.parse(call.init.body), {
    expectedRevision: 3,
    patch: { title: "جدید" },
    note: "یادداشت",
  });
});

test("login posts the optional email and never a stored token", async () => {
  reset({ session: { user: { id: "1", name: "A", email: "a@b.c", role: "owner" }, csrf: "c", expiresAt: "x" } });
  const session = await client.login({ password: "secret", email: "a@b.c" });
  assert.equal(session.user.role, "owner");
  const [call] = calls;
  assert.equal(call.url, "/api/admin/session");
  assert.deepEqual(JSON.parse(call.init.body), { password: "secret", email: "a@b.c" });
  assert.equal(call.init.credentials, "same-origin");
});

test("review lists carry the status filter and page", async () => {
  reset({ items: [], total: 0, page: 3, pageSize: 20, refreshedAt: null, refreshing: false });
  await client.getReview({ query: "  file  ", page: 3, status: "season_conflict" });
  assert.equal(calls[0].url, "/api/admin/review?query=file&page=3&status=season_conflict");
});

test("server errors keep their status and code", async () => {
  reset();
  fakeResponse = () => response(409, { error: "نسخه تغییر کرده", code: "revision_mismatch" });
  await assert.rejects(client.patchTitle("x", { expectedRevision: 1, patch: {}, note: "n" }, "c"), (error) => {
    assert.equal(error.name, "AdminApiError");
    assert.equal(error.status, 409);
    assert.equal(error.code, "revision_mismatch");
    assert.equal(error.message, "نسخه تغییر کرده");
    return true;
  });
});

test("an absent session is signed out, while a server fault is surfaced", async () => {
  reset();
  fakeResponse = () => response(401, { error: "unauthenticated" });
  assert.equal(await client.getSession(), null);

  reset();
  fakeResponse = () => response(500, { error: "boom" });
  await assert.rejects(client.getSession(), (error) => error.status === 500);
});

test("an abort signal is forwarded to fetch", async () => {
  reset({});
  const controller = new AbortController();
  await client.getOverview(controller.signal);
  assert.equal(calls[0].init.signal, controller.signal);
});

test("legacy keys live only in sessionStorage and are removed deliberately", () => {
  reset();
  assert.equal(client.readLegacyAdminKey(), "");
  sessionData.set("av_admin_key", "legacy-secret");
  assert.equal(client.readLegacyAdminKey(), "legacy-secret");
  client.clearLegacyAdminKey();
  assert.equal(sessionData.has("av_admin_key"), false);

  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("sessionStorage"), true);
});
