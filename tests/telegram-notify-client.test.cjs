const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// The provider stays a single source file, so these tests run its exported
// client helpers with transpilation and stubbed React/account modules.
function load(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(
    (name) => dependencies[name] ?? require(name),
    module,
    module.exports,
  );
  return module.exports;
}

const noop = () => {};
const reactStub = {
  createContext: () => ({ Provider: ({ children }) => children }),
  useContext: () => null,
  useCallback: (fn) => fn,
  useEffect: noop,
  useRef: (current) => ({ current }),
  useState: (initial) => [initial, noop],
};
const jsxRuntimeStub = { Fragment: Symbol("Fragment"), jsx: () => null, jsxs: () => null };
const accountClientStub = {
  getSession: async () => ({ user: null, csrf: "", preferences: null }),
  isAbortError: (error) => Boolean(error && error.name === "AbortError"),
};

const provider = load("src/components/telegram-notify-provider.tsx", {
  react: reactStub,
  "react/jsx-runtime": jsxRuntimeStub,
  "@/lib/app-context": { useApp: () => ({}) },
  "@/lib/account-client": accountClientStub,
});
const providerSource = fs.readFileSync(
  path.join(__dirname, "../src/components/telegram-notify-provider.tsx"),
  "utf8",
);
const rowSource = fs.readFileSync(
  path.join(__dirname, "../src/components/telegram-notify-row.tsx"),
  "utf8",
);

const ACCOUNT_A = "a".repeat(32);
const ACCOUNT_B = "b".repeat(32);
const CSRF = "csrf-token-from-memory-123456";

function session(userId = ACCOUNT_A, csrf = CSRF) {
  return {
    user: userId ? { id: userId, name: "Reader", email: "reader@example.test", joinedAt: "" } : null,
    csrf,
    preferences: null,
  };
}

function statusPayload(overrides = {}) {
  return {
    linked: false,
    enabled: false,
    favoritesCount: 2,
    botUsername: "AnimeVerseBot",
    pendingCode: false,
    available: true,
    ...overrides,
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function workspace(options = {}) {
  const calls = [];
  let sessionCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/status")) return jsonResponse(statusPayload());
    if (String(url).endsWith("/link")) {
      return jsonResponse({
        url: "https://t.me/AnimeVerseBot?start=verified_code",
        botUsername: "AnimeVerseBot",
        expiresIn: 300,
      });
    }
    if (String(url).endsWith("/preferences")) {
      return jsonResponse(statusPayload({ linked: true, enabled: true }));
    }
    return jsonResponse(statusPayload({ linked: false }));
  };
  const getSessionImpl = async () => {
    sessionCalls += 1;
    return session(options.userId ?? ACCOUNT_A, options.csrf ?? CSRF);
  };
  const client = provider.createNotificationClient(options.accountId ?? ACCOUNT_A, {
    fetchImpl,
    getSession: getSessionImpl,
  });
  return { calls, client, getSessionCalls: () => sessionCalls };
}

test("only server accounts are personal; local-only and signed-out profiles never qualify", () => {
  assert.equal(provider.notificationAccountId({ id: ACCOUNT_A, name: "A", email: "a@test" }), ACCOUNT_A);
  assert.equal(
    provider.notificationAccountId({ id: ACCOUNT_A, localOnly: true, name: "A", email: "a@test" }),
    null,
  );
  assert.equal(provider.notificationAccountId({ name: "A", email: "a@test" }), null);
  assert.equal(provider.notificationAccountId(null), null);

  // The row is rendered only for a server account, so signed-out rows and
  // polling cannot leak into public/local-only menus.
  assert.match(rowSource, /if \(!notificationAccountId\(user\)\) return null;/);
  assert.match(providerSource, /user\.localOnly/);
});

test("a switched or signed-out session can never send a mutation for the old account", async () => {
  const switched = workspace({ userId: ACCOUNT_B });
  for (const call of [
    () => switched.client.link(),
    () => switched.client.setEnabled(true),
    () => switched.client.unlink(),
  ]) {
    await assert.rejects(call, /حساب کاربری عوض شده/);
  }
  assert.equal(switched.calls.length, 0, "no request may leave the browser under a mismatched session");

  const signedOut = provider.createNotificationClient(ACCOUNT_A, {
    fetchImpl: async () => {
      throw new Error("must not fetch");
    },
    getSession: async () => session(null),
  });
  await assert.rejects(() => signedOut.setEnabled(false), /حساب کاربری عوض شده/);

  const noCsrf = provider.createNotificationClient(ACCOUNT_A, {
    fetchImpl: async () => {
      throw new Error("must not fetch");
    },
    getSession: async () => session(ACCOUNT_A, ""),
  });
  await assert.rejects(() => noCsrf.link(), /نشست امنیتی/);
});

test("notification requests carry no anonymous identity or favourites payload", async () => {
  const { calls, client } = workspace();
  await client.status();
  const link = await client.link();
  await client.setEnabled(false);
  await client.unlink();

  const byPath = Object.fromEntries(calls.map((call) => [new URL(call.url, "https://app.test").pathname, call]));
  assert.deepEqual(Object.keys(byPath).sort(), [
    "/api/notifications/link",
    "/api/notifications/preferences",
    "/api/notifications/status",
    "/api/notifications/unlink",
  ]);

  assert.equal(new URL(byPath["/api/notifications/status"].url, "https://app.test").search, "");
  assert.equal(byPath["/api/notifications/status"].init.method, "GET");

  assert.equal(byPath["/api/notifications/link"].init.body, "{}");
  assert.deepEqual(JSON.parse(byPath["/api/notifications/link"].init.body), {});
  assert.deepEqual(JSON.parse(byPath["/api/notifications/preferences"].init.body), { enabled: false });
  assert.equal(byPath["/api/notifications/unlink"].init.body, undefined);

  for (const call of calls) {
    const serialized = `${call.url} ${String(call.init.body ?? "")}`;
    assert.doesNotMatch(serialized, /clientId|favorites|username|accountId|av_notify_client/i);
    assert.doesNotMatch(serialized, new RegExp(ACCOUNT_A));
    assert.equal(call.init.credentials, "same-origin");
    assert.equal(call.init.cache, "no-store");
  }

  assert.equal(link.linked, undefined, "link responses must not fabricate a connected state");
  assert.deepEqual(Object.keys(link).sort(), ["botUsername", "expiresIn", "url"]);
  assert.equal(link.expiresIn, 1200, "the backend link TTL is always 20 minutes");
});

test("every mutation fetches a fresh CSRF token and sends it in X-CSRF-Token", async () => {
  const { calls, client, getSessionCalls } = workspace();
  await client.link();
  await client.setEnabled(true);
  await client.unlink();

  assert.equal(getSessionCalls(), 3, "each mutation must read the current session instead of caching a token");
  const mutations = calls.filter((call) => new URL(call.url, "https://app.test").pathname !== "/api/notifications/status");
  assert.equal(mutations.length, 3);
  for (const call of mutations) {
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("X-CSRF-Token"), CSRF);
    assert.equal(headers.get("Accept"), "application/json");
  }
  const preferences = mutations.find((call) => call.url.endsWith("/preferences"));
  assert.equal(new Headers(preferences.init.headers).get("Content-Type"), "application/json");

  const link = mutations.find((call) => call.url.endsWith("/link"));
  assert.equal(new Headers(link.init.headers).get("Content-Type"), "application/json");

  const unlink = mutations.find((call) => call.url.endsWith("/unlink"));
  assert.equal(unlink.init.method, "DELETE");
  assert.equal(unlink.init.body, undefined);
});

test("only an explicit server status can unlock connected state", () => {
  assert.equal(provider.parseTelegramNotifyStatus(statusPayload({ linked: true })).linked, true);
  assert.throws(() => provider.parseTelegramNotifyStatus(statusPayload({ linked: "true" })), /معتبر نیست/);
  assert.throws(() => provider.parseTelegramNotifyStatus({ linked: false }), /معتبر نیست/);
  assert.throws(() => provider.parseTelegramNotifyStatus(null), /معتبر نیست/);

  const connectStart = providerSource.indexOf("const connect = useCallback");
  const setEnabledStart = providerSource.indexOf("const setEnabled = useCallback", connectStart);
  const connectBlock = providerSource.slice(connectStart, setEnabledStart);
  assert.ok(connectStart > 0 && setEnabledStart > connectStart);
  assert.doesNotMatch(connectBlock, /setStatus\(/, "connect must wait for the real status endpoint");
  assert.doesNotMatch(connectBlock, /linked:\s*true/);
  assert.match(connectBlock, /window\.open\("about:blank", "_blank"\)[\s\S]*client\.link/);
  assert.match(connectBlock, /popup\.current\.opener = null/);
  assert.match(connectBlock, /verifiedTelegramLinkUrl|client\.link/);
});

test("Telegram navigation accepts only the verified bot's https t.me start URL", () => {
  const { verifiedTelegramLinkUrl } = provider;
  assert.equal(
    verifiedTelegramLinkUrl("https://t.me/AnimeVerseBot?start=abc_123", "AnimeVerseBot"),
    "https://t.me/AnimeVerseBot?start=abc_123",
  );
  assert.equal(verifiedTelegramLinkUrl("https://t.me/animeversebot?start=abc", "AnimeVerseBot"), "https://t.me/animeversebot?start=abc");
  for (const [url, bot] of [
    ["http://t.me/AnimeVerseBot?start=abc", "AnimeVerseBot"],
    ["https://example.test/AnimeVerseBot?start=abc", "AnimeVerseBot"],
    ["https://t.me/OtherBot?start=abc", "AnimeVerseBot"],
    ["https://t.me/AnimeVerseBot", "AnimeVerseBot"],
    ["https://t.me/AnimeVerseBot?start=abc&next=evil", "AnimeVerseBot"],
    ["javascript:alert(1)//?start=abc", "AnimeVerseBot"],
    ["https://t.me/AnimeVerseBot?start=abc", ""],
  ]) {
    assert.equal(verifiedTelegramLinkUrl(url, bot), null, url);
  }
});

test("a degraded Telegram worker is warned about without blocking existing preferences", () => {
  assert.equal(
    provider.parseTelegramNotifyStatus(statusPayload({ workerHealthy: false })).workerHealthy,
    false,
  );
  assert.match(providerSource, /workerHealthy === false/);
  assert.match(providerSource, /WORKER_WARNING/);
  assert.match(rowSource, /role="status"/);
  assert.match(rowSource, /\{warning\}/);
  assert.match(rowSource, /بررسی دوباره/);

  const setEnabledStart = providerSource.indexOf("const setEnabled = useCallback");
  const disconnectStart = providerSource.indexOf("const disconnect = useCallback", setEnabledStart);
  const setEnabledBlock = providerSource.slice(setEnabledStart, disconnectStart);
  assert.ok(setEnabledStart > 0 && disconnectStart > setEnabledStart);
  assert.doesNotMatch(setEnabledBlock, /workerHealthy/, "worker degradation must not disable existing preference toggles");
});

test("the displayed favourites count refreshes after the account sync finishes", () => {
  assert.match(providerSource, /pendingSyncCount !== 0/);
  assert.match(providerSource, /favoritesKey === lastFavoritesRef\.current/);
  assert.match(providerSource, /favoritesKey/);
  assert.match(providerSource, /void runStatus\(\)/);
});

test("notification state never uses browser storage and pending polling is bounded", () => {
  assert.doesNotMatch(providerSource, /localStorage|sessionStorage|CLIENT_KEY|av_notify_client/);
  assert.doesNotMatch(providerSource, /setInterval/);
  assert.match(providerSource, /Date\.now\(\) > pendingDeadlineRef\.current/);
  assert.match(providerSource, /document\.addEventListener\("visibilitychange"/);
  assert.match(providerSource, /readAbortRef\.current\?\.abort\(\)/);
  assert.match(providerSource, /controller\.abort\(\)/);
  assert.match(rowSource, /role="alert"/);
  assert.match(rowSource, /تلاش دوباره/);
  assert.match(rowSource, /فایل‌های قدیمی کپی‌شده اعلان نمی‌شوند/);
});
