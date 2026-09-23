import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { AuthClient } from "@supabase/auth-js";
import * as security from "../../src/lib/auth-security.mjs";

const id = "10000000-0000-4000-8000-000000000001";
const session = { access_token: "legacy-access", refresh_token: "legacy-refresh", user: { id } };
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const compile = (path) =>
  ts.transpileModule(readFileSync(path, "utf8").replaceAll("import.meta.env", "TEST_ENV"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

function fixture({
  mode = "dual",
  href = "https://kova.test/~oauth/callback?code=one-time-code&return_to=%2Fsettings",
  probe,
  exchange,
  redirectType = null,
} = {}) {
  const calls = [],
    created = [],
    scrubbed = [];
  let location = new URL(href);
  const env = { VITE_KOVA_AUTH_MODE: mode };
  const auth = {
    async setSession(input) {
      calls.push(["setSession", input]);
      return { data: { session }, error: null };
    },
    async exchangeCodeForSession(code) {
      calls.push(["exchangeCodeForSession", code]);
      if (exchange) await exchange;
      return { data: { session, redirectType }, error: null };
    },
    async getSession() {
      calls.push(["getSession"]);
      return { data: { session }, error: null };
    },
    async getUser() {
      calls.push(["getUser"]);
      return { data: { user: session.user }, error: null };
    },
  };
  const modules = {
    "@supabase/supabase-js": {
      createClient(_url, _key, options) {
        created.push(options);
        return { auth };
      },
    },
    "./config": {
      SUPABASE_BROWSER_CONFIG: { url: "https://data.example.invalid", publishableKey: "fixture" },
    },
    "@/lib/kova-auth-data-fetch": {
      createKovaDataFetch: () => {
        throw new Error("unexpected data client");
      },
    },
    "@/lib/auth-security.mjs": security,
  };
  const globals = {
    Response,
    URL,
    URLSearchParams,
    Error,
    AbortController,
    AbortSignal,
    setTimeout,
    TEST_ENV: env,
    window: {
      get location() {
        return location;
      },
      localStorage: {},
      history: {
        replaceState(_state, _title, path) {
          scrubbed.push(path);
          location = new URL(path, location.origin);
        },
      },
    },
    document: { title: "Login" },
    console: { error() {} },
    fetch: async (path) => {
      calls.push(["fetch", path]);
      return probe ? await probe : Response.json({ session: null });
    },
  };
  const load = (path) => {
    const exports = {};
    vm.runInNewContext(compile(path), {
      ...globals,
      exports,
      require: (name) => {
        assert.ok(modules[name], name);
        return modules[name];
      },
    });
    return exports;
  };
  const browser = load("src/lib/kova-auth-browser.ts");
  modules["@/lib/kova-auth-browser"] = browser;
  const client = load("src/integrations/supabase/client.ts");
  modules["@/integrations/supabase/client"] = client;
  const oauth = load("src/lib/oauth-session.ts");
  return { browser, client, oauth, calls, created, scrubbed, location: () => location };
}

for (const mode of ["dual", "supabase"])
  for (const implicit of [false, true]) {
    test(`${mode}: actual legacy ${implicit ? "implicit" : "PKCE"} callback waits for authority and uses the real legacy client`, async () => {
      const f = fixture({
        mode,
        ...(implicit
          ? {
              href: "https://kova.test/~oauth/callback#access_token=legacy-access&refresh_token=legacy-refresh",
            }
          : {}),
      });
      const result = await f.oauth.completeOAuthSessionFromUrl("fixture");
      assert.equal(result.user.id, id);
      assert.equal(f.created.length, 1);
      assert.ok(!f.created[0].accessToken);
      assert.equal(f.created[0].auth.detectSessionInUrl, false);
      assert.ok(
        f.calls.some(([name]) => name === (implicit ? "setSession" : "exchangeCodeForSession")),
      );
      assert.equal(f.location().hash, "");
      assert.equal(f.location().search, "");
      assert.ok(f.scrubbed.length > 0);
    });
  }

test("the provider and callback share one pending probe instead of racing legacy selection", async () => {
  const gate = deferred(),
    f = fixture({ probe: gate.promise });
  const provider = f.browser.resolveKovaSessionAuthority();
  const callback = f.oauth.completeOAuthSessionFromUrl("fixture");
  assert.equal(f.created.length, 0);
  gate.resolve(Response.json({ session: null }));
  assert.equal(await provider, null);
  assert.equal((await callback).user.id, id);
  assert.equal(f.calls.filter(([name]) => name === "fetch").length, 1);
});

for (const [name, response] of [
  ["revoked", new Response(null, { status: 401 })],
  ["outage", new Response(null, { status: 503 })],
  ["malformed", Response.json({ unexpected: true })],
  [
    "owned",
    Response.json({
      session: {
        accountId: id,
        sessionId: "owned-session",
        email: "real@example.invalid",
        emailVerified: true,
        assuranceLevel: "aal2",
        expiresAt: "2027-01-01T00:00:00Z",
      },
    }),
  ],
])
  test(`dual ${name}: no legacy client, token exchange or silent fallback`, async () => {
    const f = fixture({ probe: response });
    await assert.rejects(f.oauth.completeOAuthSessionFromUrl("fixture"));
    assert.equal(f.created.length, 0);
    assert.ok(f.calls.every(([name]) => name === "fetch"));
    assert.equal(f.location().search, "");
  });

test("pure Kova rejects hosted callbacks before any probe, SDK construction or exchange", async () => {
  const f = fixture({ mode: "kova" });
  await assert.rejects(f.oauth.completeOAuthSessionFromUrl("fixture"), /hosted_auth_unavailable/u);
  assert.equal(f.calls.length, 0);
  assert.equal(f.created.length, 0);
  assert.equal(f.location().search, "");
});

test("logout or authority change during an admitted exchange prevents later persistence, reads and redirect-ready success", async () => {
  const gate = deferred(),
    f = fixture({ exchange: gate.promise });
  const work = f.oauth.completeOAuthSessionFromUrl("fixture");
  const rejection = assert.rejects(work, /auth_authority_changed/u);
  while (!f.calls.some(([name]) => name === "exchangeCodeForSession"))
    await new Promise((r) => setImmediate(r));
  f.browser.setKovaSessionActive(true);
  gate.resolve();
  await rejection;
  assert.ok(!f.calls.some(([name]) => ["setSession", "getUser", "getSession"].includes(name)));
});

test("a timed-out or unmounted callback cannot dispatch after its delayed cookie probe", async () => {
  const gate = deferred(),
    f = fixture({ probe: gate.promise }),
    controller = new AbortController();
  const work = f.oauth.completeOAuthSessionFromUrl("fixture", controller.signal);
  const rejection = assert.rejects(work, /abort/iu);
  controller.abort();
  gate.resolve(Response.json({ session: null }));
  await rejection;
  assert.ok(!f.calls.some(([name]) => name === "exchangeCodeForSession"));
});

test("callbacks never use raw query access/refresh tokens as credentials", async () => {
  const f = fixture({
    href: "https://kova.test/~oauth/callback?access_token=should-not-use&refresh_token=should-not-use",
  });
  await f.oauth.completeOAuthSessionFromUrl("fixture");
  assert.ok(!JSON.stringify(f.calls).includes("should-not-use"));
  assert.equal(f.location().search, "");
});

test("legacy recovery requires a PKCE-bound recovery flow rather than a query flag or ordinary session", async () => {
  for (const href of [
    "https://kova.test/reset-password",
    "https://kova.test/reset-password?access_token=ignored&refresh_token=ignored&type=recovery",
    "https://kova.test/reset-password?code=sign-in-code&type=recovery",
  ]) {
    const f = fixture({ href });
    await assert.rejects(
      f.oauth.completeOAuthSessionFromUrl("reset", undefined, { recoveryOnly: true }),
      /password_recovery_proof_required/u,
    );
  }
  const valid = fixture({
    href: "https://kova.test/reset-password?code=reset-code",
    redirectType: "recovery",
  });
  assert.equal(
    (await valid.oauth.completeOAuthSessionFromUrl("reset", undefined, { recoveryOnly: true })).user
      .id,
    id,
  );
});

test("implicit recovery requires both real fragment credentials and its recovery ceremony", async () => {
  const url =
    "https://kova.test/reset-password#access_token=legacy-access&refresh_token=legacy-refresh";
  const missing = fixture({ href: url });
  await assert.rejects(
    missing.oauth.completeOAuthSessionFromUrl("reset", undefined, { recoveryOnly: true }),
    /password_recovery_proof_required/u,
  );
  assert.ok(!missing.calls.some(([method]) => method === "setSession"));
  const valid = fixture({ href: url + "&type=recovery" });
  assert.equal(
    (await valid.oauth.completeOAuthSessionFromUrl("reset", undefined, { recoveryOnly: true })).user
      .id,
    id,
  );
});

test("the pinned real SDK returns recovery metadata bound to its stored PKCE verifier", async () => {
  for (const recovery of [false, true]) {
    const key = `kova-pkce-proof-${recovery}`;
    const verifier = "v".repeat(43);
    const values = new Map([
      [`${key}-code-verifier`, JSON.stringify(verifier + (recovery ? "/recovery" : ""))],
    ]);
    const client = new AuthClient({
      url: "https://auth.example.invalid",
      storageKey: key,
      storage: {
        getItem: (k) => values.get(k) ?? null,
        setItem: (k, v) => values.set(k, v),
        removeItem: (k) => values.delete(k),
      },
      flowType: "pkce",
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      fetch: async (url, init) => {
        assert.equal(String(url), "https://auth.example.invalid/token?grant_type=pkce");
        assert.equal(JSON.parse(init.body).code_verifier, verifier);
        return Response.json({
          access_token: "fixture-access",
          refresh_token: "fixture-refresh",
          expires_in: 3600,
          token_type: "bearer",
          user: { id, aud: "authenticated" },
        });
      },
    });
    try {
      const result = await client.exchangeCodeForSession("one-use-code");
      assert.equal(result.error, null);
      assert.equal(result.data.redirectType, recovery ? "recovery" : null);
    } finally {
      await client.stopAutoRefresh();
    }
  }
});
