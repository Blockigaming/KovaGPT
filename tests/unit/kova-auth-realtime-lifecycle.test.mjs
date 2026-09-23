import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync("src/lib/kova-auth-realtime.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const owner = "10000000-0000-4000-8000-000000000001";
const session = "20000000-0000-4000-8000-000000000002";
const other = "30000000-0000-4000-8000-000000000003";
const wallStart = Date.parse("2026-09-23T17:00:00Z");
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise(setImmediate);
};
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function reply(overrides = {}) {
  return {
    accessToken: "fixture.payload.signature",
    expiresIn: 300,
    session: {
      accountId: owner,
      sessionId: session,
      email: "owner@example.invalid",
      emailVerified: true,
      assuranceLevel: "aal2",
      expiresAt: new Date(wallStart + 3600000).toISOString(),
      displayName: null,
    },
    ...overrides,
  };
}
function fixture({ response, active = true } = {}) {
  let monotonic = 0,
    wall = wallStart,
    generation = 0,
    timerId = 0;
  const tasks = new Map(),
    observers = new Set(),
    replies = [];
  const events = {
    fetch: [],
    created: 0,
    auth: [],
    subscribed: 0,
    unsubscribed: 0,
    tornDown: 0,
    disconnected: 0,
    invalidate: 0,
    denied: 0,
    status: [],
  };
  const channel = {
    on(_type, _filter, callback) {
      this.callback = callback;
      return this;
    },
    subscribe(callback) {
      events.subscribed++;
      this.status = callback;
      return this;
    },
    unsubscribe: async () => {
      events.unsubscribed++;
      return "ok";
    },
    teardown: () => {
      events.tornDown++;
    },
  };
  let socket;
  class RealtimeClient {
    constructor(url, options) {
      assert.equal(url, "https://data.example.invalid/realtime/v1");
      assert.equal(options.params.apikey, "public-fixture-key");
      this.options = options;
      socket = this;
      events.created++;
    }
    async setAuth(token) {
      if (token === undefined) {
        try {
          token = await this.options.accessToken();
        } catch {
          token = this.token;
        } // Mirror SDK's dangerous cached-token fallback.
      }
      this.token = token;
      events.auth.push(token);
    }
    channel(topic) {
      assert.match(topic, /^kova-collaboration:/u);
      return channel;
    }
    async disconnect() {
      events.disconnected++;
    }
  }
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    Response,
    Uint8Array,
    TextDecoder,
    AbortController,
    performance: { now: () => monotonic },
    Date: class extends Date {
      static now() {
        return wall;
      }
    },
    setTimeout: (fn, delay) => {
      tasks.set(++timerId, { fn, at: monotonic + delay });
      return timerId;
    },
    clearTimeout: (id) => tasks.delete(id),
    fetch: async (path, init) => {
      assert.equal(path, "/api/auth/token");
      assert.equal(init.credentials, "same-origin");
      assert.equal(init.mode, "same-origin");
      assert.equal(init.headers["X-Kova-Owner"], owner);
      assert.equal(init.cache, "no-store");
      assert.equal(init.redirect, "error");
      assert.equal(init.method, "GET");
      events.fetch.push(init);
      const value = replies.length ? replies.shift() : response;
      return typeof value === "function" ? value(init) : (value ?? Response.json(reply()));
    },
    require: (name) => {
      if (name === "@supabase/supabase-js") return { RealtimeClient };
      if (name === "@/integrations/supabase/config")
        return {
          SUPABASE_BROWSER_CONFIG: {
            url: "https://data.example.invalid",
            publishableKey: "public-fixture-key",
          },
        };
      assert.equal(name, "./kova-auth-browser");
      return {
        isKovaSessionActive: () => active,
        kovaAuthGeneration: () => generation,
        subscribeKovaAuthChanges: (callback) => {
          observers.add(callback);
          return () => observers.delete(callback);
        },
      };
    },
  });
  const stop = exports.subscribeOwnedRealtime({
    ownerId: owner,
    topic: "kova-collaboration:project:fixture",
    bind: (c, callback) => c.on("postgres_changes", {}, callback),
    invalidate: () => events.invalidate++,
    onStatus: (status) => events.status.push(status),
    onDenied: () => events.denied++,
  });
  return {
    events,
    tasks,
    observers,
    replies,
    stop,
    get socket() {
      return socket;
    },
    frame: () => channel.callback?.(),
    status: (value = "SUBSCRIBED") => channel.status?.(value),
    revoke() {
      generation++;
      for (const observer of [...observers]) observer();
    },
    switchWithoutEvent() {
      active = false;
    },
    clockJump(ms) {
      wall += ms;
    },
    async advance(ms, runTimers = true) {
      const target = monotonic + ms;
      if (runTimers) {
        for (;;) {
          const next = [...tasks.entries()]
            .filter(([, t]) => t.at <= target)
            .sort((a, b) => a[1].at - b[1].at)[0];
          if (!next) break;
          tasks.delete(next[0]);
          wall += next[1].at - monotonic;
          monotonic = next[1].at;
          next[1].fn();
          await flush();
        }
      }
      wall += target - monotonic;
      monotonic = target;
      await flush();
    },
  };
}

test("owned subscriptions obtain fresh cookie-backed authority before creating a dedicated socket", async () => {
  const f = fixture();
  assert.equal(f.events.subscribed, 0);
  await flush();
  assert.equal(f.events.fetch.length, 1);
  assert.equal(f.events.fetch[0].headers["X-Kova-Session"], undefined);
  assert.equal(f.events.created, 1);
  assert.equal(f.events.subscribed, 1);
  f.status();
  f.frame();
  assert.deepEqual(f.events.status, ["SUBSCRIBED"]);
  assert.equal(f.events.invalidate, 1);
  assert.equal(await f.socket.options.accessToken(), "fixture.payload.signature");
  assert.equal(f.events.fetch.length, 1, "SDK bootstrap can reuse only the active short lease");
  f.stop();
  assert.equal(f.observers.size, 0);
  assert.equal(f.tasks.size, 0);
  assert.equal(f.events.tornDown, 1);
  assert.equal(f.events.disconnected, 1);
});

test("live authority is renewed at fifteen seconds, without reconnecting or using the global JWT cache", async () => {
  const f = fixture();
  await flush();
  f.replies.push(Response.json(reply({ accessToken: "renewed.payload.signature" })));
  await f.advance(15000);
  assert.equal(f.events.fetch.length, 2);
  assert.equal(f.events.fetch[1].headers["X-Kova-Session"], session);
  assert.equal(f.socket.token, "renewed.payload.signature");
  assert.equal(f.events.created, 1);
  await f.advance(15000);
  assert.equal(f.events.fetch.length, 3);
  f.frame();
  assert.equal(f.events.invalidate, 1);
  f.stop();
});

test("owned lease rejection notifies the enclosing lifecycle exactly once", async () => {
  const f = fixture();
  await flush();
  f.replies.push(Response.json({ error: "revoked" }, { status: 401 }));
  await f.advance(15000);
  assert.equal(f.events.denied, 1);
  assert.equal(f.tasks.size, 0);
  f.frame();
  f.revoke();
  f.stop();
  assert.equal(f.events.denied, 1);
  assert.equal(f.events.invalidate, 0);
});

for (const [name, mutate] of [
  [
    "foreign account",
    (p) => {
      p.session.accountId = other;
    },
  ],
  [
    "unverified identity",
    (p) => {
      p.session.emailVerified = false;
    },
  ],
  [
    "missing session",
    (p) => {
      delete p.session;
    },
  ],
  [
    "malformed session id",
    (p) => {
      p.session.sessionId = "not-a-session";
    },
  ],
  [
    "expired session",
    (p) => {
      p.session.expiresAt = new Date(wallStart).toISOString();
    },
  ],
  [
    "invalid expiry",
    (p) => {
      p.session.expiresAt = "infinity";
    },
  ],
  [
    "invalid assurance",
    (p) => {
      p.session.assuranceLevel = "aal3";
    },
  ],
  [
    "empty token",
    (p) => {
      p.accessToken = "";
    },
  ],
  [
    "oversized token lifetime",
    (p) => {
      p.expiresIn = 301;
    },
  ],
]) {
  test(`untrusted lease ${name} cannot create a socket or subscribe`, async () => {
    const payload = reply();
    mutate(payload);
    const f = fixture({ response: Response.json(payload) });
    await flush();
    assert.equal(f.events.created, 0);
    assert.equal(f.events.subscribed, 0);
    assert.deepEqual(f.events.status, ["CHANNEL_ERROR"]);
    assert.equal(f.tasks.size, 0);
    assert.equal(f.observers.size, 0);
  });
}

for (const status of [401, 403, 503]) {
  test(`renewal HTTP ${status} tears down the socket and cannot fall back to the cached token`, async () => {
    const f = fixture();
    await flush();
    f.replies.push(new Response(null, { status }));
    await f.advance(15000);
    assert.equal(f.socket.token, null);
    assert.equal(f.events.tornDown, 1);
    assert.equal(f.events.disconnected, 1);
    f.frame();
    f.status();
    assert.equal(f.events.invalidate, 0);
    assert.deepEqual(f.events.status, ["CHANNEL_ERROR"]);
    assert.equal(f.tasks.size, 0);
    assert.equal(await f.socket.options.accessToken(), null);
    assert.equal(f.events.fetch.length, 2);
  });
}

for (const changed of [
  { sessionId: other },
  { email: "changed@example.invalid" },
  { assuranceLevel: "aal1" },
]) {
  test(`renewal cannot cross the captured session binding ${JSON.stringify(changed)}`, async () => {
    const f = fixture();
    await flush();
    const payload = reply();
    Object.assign(payload.session, changed);
    f.replies.push(Response.json(payload));
    await f.advance(15000);
    assert.equal(f.events.disconnected, 1);
    assert.equal(f.socket.token, null);
    f.frame();
    assert.equal(f.events.invalidate, 0);
  });
}

test("local revocation synchronously removes listeners, timers and delivery even while unsubscribe awaits acknowledgement", async () => {
  const f = fixture();
  await flush();
  f.revoke();
  f.frame();
  f.status();
  f.stop();
  f.revoke();
  assert.equal(f.events.invalidate, 0);
  assert.equal(f.events.tornDown, 1);
  assert.equal(f.events.disconnected, 1);
  assert.equal(f.events.unsubscribed, 1);
  assert.equal(f.tasks.size, 0);
  assert.equal(f.observers.size, 0);
});

test("a delayed initial token cannot create a channel after owner authority changes", async () => {
  const pending = deferred();
  const f = fixture({ response: () => pending.promise });
  f.revoke();
  pending.resolve(Response.json(reply()));
  await flush();
  assert.equal(f.events.created, 0);
  assert.equal(f.events.subscribed, 0);
  assert.equal(f.tasks.size, 0);
});

test("a delayed renewed token cannot revive a retired socket", async () => {
  const f = fixture();
  await flush();
  const pending = deferred();
  f.replies.push(() => pending.promise);
  await f.advance(15000);
  f.revoke();
  pending.resolve(Response.json(reply()));
  await flush();
  assert.equal(f.socket.token, null);
  assert.equal(f.events.subscribed, 1);
  assert.equal(f.events.disconnected, 1);
  assert.equal(f.tasks.size, 0);
});

test("concurrent SDK heartbeat refreshes share one live HTTP recheck", async () => {
  const f = fixture();
  await flush();
  const pending = deferred();
  f.replies.push(() => pending.promise);
  await f.advance(15000, false);
  const checks = [
    f.socket.options.accessToken(),
    f.socket.options.accessToken(),
    f.socket.options.accessToken(),
  ];
  assert.equal(f.events.fetch.length, 2);
  pending.resolve(Response.json(reply()));
  assert.deepEqual(await Promise.all(checks), Array(3).fill("fixture.payload.signature"));
  assert.equal(f.events.fetch.length, 2);
  f.stop();
});

test("a hidden-tab timer delay and backward wall-clock jump cannot extend callback authorization", async () => {
  const f = fixture();
  await flush();
  f.clockJump(-60000);
  await f.advance(30001, false);
  f.frame();
  f.status();
  assert.equal(f.events.invalidate, 0);
  assert.equal(f.events.disconnected, 1);
  assert.equal(f.tasks.size, 0);
});

test("a provider change without its observer event still rejects queued frames", async () => {
  const f = fixture();
  await flush();
  f.switchWithoutEvent();
  f.frame();
  assert.equal(f.events.disconnected, 1);
  assert.equal(f.events.invalidate, 0);
});

test("hung fetch and hung response bodies are cancelled at five seconds without a socket", async () => {
  for (const response of [
    () => new Promise(() => {}),
    new Response(new ReadableStream({ start() {} })),
  ]) {
    const f = fixture({ response });
    await flush();
    await f.advance(5000);
    assert.equal(f.events.created, 0);
    assert.equal(f.events.fetch[0].signal.aborted, true);
    assert.equal(f.tasks.size, 0);
    assert.deepEqual(f.events.status, ["CHANNEL_ERROR"]);
  }
});

test("oversized or malformed token replies never reach the socket", async () => {
  for (const response of [
    new Response("x".repeat(16385)),
    new Response("invalid JSON"),
    new Response(new Uint8Array([255])),
  ]) {
    const f = fixture({ response });
    await flush();
    assert.equal(f.events.created, 0);
    assert.deepEqual(f.events.status, ["CHANNEL_ERROR"]);
    assert.equal(f.tasks.size, 0);
  }
});

test("hosted authority cannot enter the owned socket path", async () => {
  const f = fixture({ active: false });
  await flush();
  assert.equal(f.events.fetch.length, 0);
  assert.equal(f.events.created, 0);
  assert.equal(f.observers.size, 0);
});
