import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { safeRelativeRedirect } from "../../src/lib/auth-security.mjs";
const transpile = (path) =>
  ts.transpileModule(readFileSync(path, "utf8").replaceAll("import.meta.env", "TEST_ENV"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const sources = {
  browser: transpile("src/lib/kova-auth-browser.ts"),
  client: transpile("src/integrations/supabase/client.ts"),
  oauth: transpile("src/lib/oauth-session.ts"),
};
function fixture(mode = "dual", probe = () => Response.json({ session: null })) {
  const events = [];
  let releaseExchange;
  const location = new URL("https://kova.test/~oauth/callback?code=legacy-code&return_to=%2F");
  const session = {
    access_token: "legacy-access",
    refresh_token: "legacy-refresh",
    user: { id: "legacy-owner" },
  };
  const raw = {
    setSession: async () => {
      events.push("setSession");
      return { data: { session }, error: null };
    },
    exchangeCodeForSession: async () => {
      events.push("exchange");
      if (releaseExchange) await releaseExchange.promise;
      return { data: { session }, error: null };
    },
    getSession: async () => {
      events.push("getSession");
      return { data: { session }, error: null };
    },
    getUser: async () => {
      events.push("getUser");
      return { data: { user: session.user }, error: null };
    },
  };
  const modules = {
    "@supabase/supabase-js": {
      createClient: (_url, _key, options) => {
        assert.equal(
          options.accessToken,
          undefined,
          "legacy callback never touches the provisional Kova client",
        );
        events.push("createLegacy");
        return { auth: raw };
      },
    },
    "./config": {
      SUPABASE_BROWSER_CONFIG: { url: "https://fixture.supabase.co", publishableKey: "fixture" },
    },
    "@/lib/kova-auth-data-fetch": { createKovaDataFetch: () => assert.fail("no data client") },
    "@/lib/auth-security.mjs": { safeRelativeRedirect },
  };
  const globals = {
    Response,
    Request,
    Headers,
    URL,
    URLSearchParams,
    Error,
    Date,
    Promise,
    setTimeout,
    TEST_ENV: { VITE_KOVA_AUTH_MODE: mode },
    fetch: async (path) => {
      events.push("probe");
      assert.equal(path, "/api/auth/session");
      return probe();
    },
    window: {
      location,
      localStorage: {},
      history: {
        replaceState: (_state, _title, path) => {
          events.push("scrub");
          location.href = new URL(path, location).href;
        },
      },
    },
    document: { title: "Auth" },
    sessionStorage: { getItem: () => null, removeItem: () => {} },
    console: { error: () => {} },
  };
  const load = (source) => {
    const exports = {};
    vm.runInNewContext(source, {
      ...globals,
      exports,
      require: (name) => {
        assert.ok(modules[name], name);
        return modules[name];
      },
    });
    return exports;
  };
  const browser = load(sources.browser);
  modules["@/lib/kova-auth-browser"] = browser;
  const client = load(sources.client);
  modules["@/integrations/supabase/client"] = client;
  const oauth = load(sources.oauth);
  return {
    events,
    browser,
    client,
    oauth,
    location,
    holdExchange() {
      let release;
      const promise = new Promise((r) => (release = r));
      releaseExchange = { promise };
      return release;
    },
  };
}
for (const kind of ["pkce", "implicit"])
  test(`dual ${kind}: wait for the shared cookie decision, scrub credentials and use the hosted client exactly once`, async () => {
    let release;
    const waiting = new Promise((r) => (release = r));
    const f = fixture("dual", async () => {
      await waiting;
      return Response.json({ session: null });
    });
    if (kind === "implicit")
      f.location.href =
        "https://kova.test/~oauth/callback#access_token=legacy-access&refresh_token=legacy-refresh";
    const root = f.browser.resolveKovaSessionAuthority();
    const result = f.oauth.completeOAuthSessionFromUrl("test");
    await Promise.resolve();
    assert.ok(
      !f.location.href.includes("legacy-"),
      "credentials removed before the cookie response",
    );
    assert.deepEqual(f.events, ["probe", "scrub"]);
    release();
    await root;
    assert.equal((await result).user.id, "legacy-owner");
    assert.equal(f.events.filter((e) => e === "probe").length, 1);
    assert.equal(f.events.filter((e) => e === "createLegacy").length, 1);
    assert.equal(f.browser.isKovaSessionActive(), false);
  });
for (const [label, mode, probe] of [
  ["pure Kova", "kova", () => assert.fail("no hosted probe in pure Kova")],
  ["rejected Kova cookie", "dual", () => new Response(null, { status: 401 })],
  ["unavailable authority", "dual", () => new Response(null, { status: 503 })],
  [
    "active Kova session",
    "dual",
    () =>
      Response.json({
        session: {
          accountId: "kova-owner",
          sessionId: "session",
          email: "owner@example.invalid",
          emailVerified: true,
          assuranceLevel: "aal1",
          expiresAt: "2026-10-01T00:00:00Z",
        },
      }),
  ],
])
  test(`${label}: legacy callbacks cannot exchange credentials or create a hosted client`, async () => {
    const f = fixture(mode, probe);
    await assert.rejects(f.oauth.completeOAuthSessionFromUrl("test"));
    assert.ok(!f.events.includes("createLegacy"));
    assert.ok(!f.events.includes("exchange"));
    assert.ok(!f.events.includes("setSession"));
    assert.ok(!f.location.href.includes("legacy-code"));
  });

test("a callback completing after an owned-authority switch cannot publish the old session or continue SDK work", async () => {
  const f = fixture();
  const release = f.holdExchange();
  const result = f.oauth.completeOAuthSessionFromUrl("test");
  const rejected = assert.rejects(result, /authority_changed/);
  for (let i = 0; i < 20 && !f.events.includes("exchange"); i++)
    await new Promise((r) => setTimeout(r, 0));
  assert.ok(f.events.includes("exchange"));
  f.browser.setKovaSessionActive(true);
  release();
  await rejected;
  assert.ok(!f.events.includes("setSession"));
  assert.ok(!f.events.includes("getUser"));
});
