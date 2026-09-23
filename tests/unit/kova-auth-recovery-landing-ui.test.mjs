import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
import * as landing from "../../src/lib/kova-recovery-landing.mjs";

const token = "A".repeat(43);
const owner = "10000000-0000-4000-8000-000000000001";
const defer = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

function fixture({
  href = `https://kova.test/reset-password#token=${token}`,
  mode = "kova",
  delay,
  response = Response.json({ session: { accountId: owner, emailVerified: true } }),
  callback,
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
        return { data: { session: { user: { id: owner } } }, error: null };
      },
      async updateUser(input) {
        calls.push(["update", input]);
        return { error: null };
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
      "@/lib/kova-auth-browser": {
        browserKovaAuthEnabled: () => mode !== "supabase",
        browserKovaAuthMode: () => mode,
        async kovaAuthJson(path, body) {
          calls.push([path, body]);
          if (delay) await delay;
          return response;
        },
      },
      "@/lib/kova-recovery-landing.mjs": landing,
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
          if (callback) await callback;
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

test("actual owned recovery form scrubs the URL before accepting a password and only submits the captured fragment", async () => {
  const f = fixture();
  await f.flush();
  assert.equal(f.url().hash, "");
  assert.equal(f.calls[0], "scrub");
  await f.input("new-pw", "a secure test password");
  await f.input("confirm-pw", "a secure test password");
  await f.submit();
  await f.flush();
  const request = f.calls.find((v) => Array.isArray(v));
  assert.equal(request[0], "/api/auth/recovery/reset");
  assert.equal(request[1].token, token);
  assert.ok(!f.calls.includes("legacy"));
  assert.deepEqual(f.redirects, ["/"]);
});
for (const href of [
  `https://kova.test/reset-password?token=${token}`,
  `https://kova.test/reset-password#token=${token}&token=${token}`,
  "https://kova.test/reset-password#token=invalid",
  "https://kova.test/reset-password?code=legacy-code",
])
  test(`owned recovery rejects unsafe/legacy landing ${href.split("reset-password")[1].slice(0, 18)}`, async () => {
    const f = fixture({ href });
    await f.flush();
    assert.equal(f.nodes().filter((n) => n.type === "form").length, 0);
    assert.equal(f.url().search, "");
    assert.equal(f.url().hash, "");
    assert.ok(!f.calls.includes("legacy"));
    assert.ok(!f.calls.includes("callback"));
  });
test("reset failures clear both plaintext fields and an unconfirmed 200 cannot claim success", async () => {
  const f = fixture({ response: Response.json({}) });
  await f.flush();
  await f.input("new-pw", "a secure test password");
  await f.input("confirm-pw", "a secure test password");
  await f.submit();
  await f.flush();
  assert.equal(f.find("input", (n) => n.props.id === "new-pw").props.value, "");
  assert.equal(f.find("input", (n) => n.props.id === "confirm-pw").props.value, "");
  assert.deepEqual(f.redirects, []);
  assert.ok(!f.messages.some(([kind]) => kind === "success"));
});
test("owned reset cannot duplicate a pending mutation or redirect after unmount", async () => {
  const gate = defer(),
    f = fixture({ delay: gate.promise });
  await f.flush();
  await f.input("new-pw", "a secure test password");
  await f.input("confirm-pw", "a secure test password");
  const first = f.submit();
  const second = f.submit();
  f.unmount();
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(f.calls.filter((v) => Array.isArray(v)).length, 1);
  assert.deepEqual(f.redirects, []);
  assert.deepEqual(f.messages, []);
});
test("dual legacy recovery waits for its single callback and cannot modify a changed authority", async () => {
  const f = fixture({ mode: "dual", href: "https://kova.test/reset-password?code=legacy-code" });
  await f.flush();
  assert.equal(f.calls.filter((v) => v === "callback").length, 1);
  await f.input("new-pw", "a secure test password");
  await f.input("confirm-pw", "a secure test password");
  f.invalidate();
  await f.submit();
  assert.ok(!f.calls.some((v) => Array.isArray(v)));
  assert.deepEqual(f.redirects, []);
});
test("timed-out legacy recovery cannot make a late callback usable", async () => {
  const gate = defer(),
    f = fixture({
      mode: "dual",
      href: "https://kova.test/reset-password?code=legacy-code",
      callback: gate.promise,
    });
  await f.flush();
  f.timers[0]();
  gate.resolve();
  await f.flush();
  assert.equal(f.nodes().filter((n) => n.type === "form").length, 0);
  assert.ok(!f.calls.includes("legacy"));
});
