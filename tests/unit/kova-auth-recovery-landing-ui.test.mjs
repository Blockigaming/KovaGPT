import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";

const owner = "10000000-0000-4000-8000-000000000001";
const defer = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

function fixture({
  href = "https://kova.test/reset-password?code=recovery-code",
  updateDelay,
  updateError = null,
  callback,
  callbackError = false,
  sessionOwner = owner,
} = {}) {
  const calls = [],
    redirects = [],
    messages = [],
    timers = [];
  let url = new URL(href),
    valid = true;
  const context = {
    assertCurrent() {
      if (!valid) throw new Error("authority_changed");
    },
    auth: {
      async getSession() {
        calls.push("session");
        return { data: { session: { user: { id: sessionOwner } } }, error: null };
      },
      async updateUser(input) {
        calls.push(["update", input]);
        if (updateDelay) await updateDelay;
        return { error: updateError };
      },
      async signOut(input) {
        calls.push(["signOut", input]);
        return { error: null };
      },
    },
  };
  const f = reactFixture("src/routes/reset-password.tsx", (e) => e.Route.component, {
    modules: {
      "@tanstack/react-router": {
        createFileRoute: () => (config) => config,
        useNavigate: () => (to) => redirects.push(to),
      },
      "@/components/NovaLogo": { NovaLogo: "Logo" },
      "@/integrations/supabase/client": {
        getSupabaseClientConfigStatus: () => ({ configured: true }),
        resolveLegacyAuthContext: async () => {
          calls.push("legacy");
          return context;
        },
      },
      "@/lib/oauth-session": {
        hasOAuthResponseInUrl: () => url.searchParams.has("code"),
        hasRecentPasswordRecoveryFlow: () => false,
        clearOAuthResponseFromUrl() {
          url.search = "";
          url.hash = "";
          calls.push("scrubLegacy");
        },
        clearPasswordRecoveryFlow() {
          calls.push("clear");
        },
        markPasswordRecoveryFlow() {
          calls.push("mark");
        },
        async completeOAuthSessionFromUrl(_source, signal, options) {
          assert.equal(options.recoveryOnly, true);
          calls.push("callback");
          url.search = "";
          url.hash = "";
          if (callback) await callback;
          if (callbackError) throw new Error("invalid_recovery");
          signal.throwIfAborted();
          return { user: { id: owner } };
        },
      },
      sonner: {
        toast: {
          success: (m) => messages.push(["success", m]),
          warning: (m) => messages.push(["warning", m]),
          error: (m) => messages.push(["error", m]),
        },
      },
    },
    globals: {
      AbortController,
      document: { title: "Reset" },
      console: { error() {} },
      window: {
        location: {
          get href() {
            return url.href;
          },
          replace(path) {
            redirects.push(path);
          },
        },
        history: {
          replaceState(_s, _t, path) {
            calls.push("scrub");
            url = new URL(path, url.origin);
          },
        },
        setTimeout(fn) {
          timers.push(fn);
          return timers.length;
        },
        clearTimeout() {},
      },
    },
  });
  return {
    ...f,
    get tree() {
      return f.tree;
    },
    calls,
    redirects,
    messages,
    timers,
    url: () => url,
    invalidate() {
      valid = false;
    },
  };
}

test("Supabase recovery waits for authorization and updates only the recovered account", async () => {
  const f = fixture();
  await f.flush();
  assert.equal(f.calls.filter((v) => v === "callback").length, 1);
  assert.equal(f.url().search, "");
  await f.input("new-pw", "a secure test password");
  await f.input("confirm-pw", "a secure test password");
  await f.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.filter(Array.isArray))), [
    ["update", { password: "a secure test password" }],
    ["signOut", { scope: "others" }],
  ]);
  assert.ok(f.messages.some(([kind]) => kind === "success"));
  assert.equal(f.redirects.length, 1);
});

test("invalid recovery authorization never exposes a reset form", async () => {
  const f = fixture({ callbackError: true });
  await f.flush();
  assert.match(f.text(), /invalid or has expired/u);
  assert.equal(f.nodes().filter((n) => n.type === "form").length, 0);
  assert.ok(!f.calls.includes("legacy"));
});

test("recovery does not change a different session owner or invalidated authority", async () => {
  for (const changed of [false, true]) {
    const f = fixture({ sessionOwner: changed ? "different-user" : owner });
    await f.flush();
    await f.input("new-pw", "a secure test password");
    await f.input("confirm-pw", "a secure test password");
    if (!changed) f.invalidate();
    await f.submit();
    assert.ok(!f.calls.some(Array.isArray));
    assert.deepEqual(f.redirects, []);
  }
});

test("Supabase update errors do not claim success or revoke other sessions", async () => {
  const f = fixture({ updateError: new Error("provider_failure") });
  await f.flush();
  await f.input("new-pw", "a secure test password");
  await f.input("confirm-pw", "a secure test password");
  await f.submit();
  assert.equal(f.calls.filter(Array.isArray).length, 1);
  assert.ok(!f.messages.some(([kind]) => kind === "success"));
  assert.deepEqual(f.redirects, []);
});

test("pending reset mutation is not duplicated and cannot redirect after unmount", async () => {
  const gate = defer();
  const f = fixture({ updateDelay: gate.promise });
  await f.flush();
  await f.input("new-pw", "a secure test password");
  await f.input("confirm-pw", "a secure test password");
  const first = f.submit();
  const second = f.submit();
  while (!f.calls.some(Array.isArray)) await new Promise((r) => setImmediate(r));
  f.unmount();
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(f.calls.filter(Array.isArray).length, 1);
  assert.deepEqual(f.redirects, []);
});

test("timed-out recovery cannot make a late callback usable", async () => {
  const gate = defer();
  const f = fixture({ callback: gate.promise });
  await f.flush();
  f.timers[0]();
  gate.resolve();
  await f.flush();
  assert.equal(f.nodes().filter((n) => n.type === "form").length, 0);
  assert.ok(!f.calls.includes("legacy"));
});
