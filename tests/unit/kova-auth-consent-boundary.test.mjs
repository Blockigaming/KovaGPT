import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
const details = {
  authorization_id: "request",
  redirect_uri: "https://client.example/callback",
  client: { id: "client", name: "Example", uri: "https://client.example", logo_uri: "" },
  user: { id: "owner", email: "real@example.invalid" },
  scope: "openid email",
};
const defer = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

function fixture({
  denied = false,
  delay,
  detailResponse = details,
  target = "https://client.example/callback?code=opaque",
  sdkOAuth,
} = {}) {
  const calls = [],
    redirects = [];
  let valid = true,
    listener;
  const session = { user: { id: "owner", email: "real@example.invalid" } };
  const context = {
    assertCurrent() {
      if (!valid) throw new Error("authority_changed");
    },
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange(cb) {
        listener = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      oauth: sdkOAuth ?? {
        getAuthorizationDetails: async () => ({ data: detailResponse, error: null }),
        async approveAuthorization(id, options) {
          calls.push([id, options]);
          if (delay) await delay;
          return { data: { redirect_url: target }, error: null };
        },
        async denyAuthorization(id, options) {
          calls.push([id, options]);
          return { data: { redirect_url: target }, error: null };
        },
      },
    },
  };
  const f = reactFixture(
    "src/routes/oauth.consent.tsx",
    (exp) => (denied ? exp.Route.component : () => exp.LegacyConsentRoute({ context })),
    {
      sourceSuffix: "\nexport { LegacyConsentRoute };",
      modules: {
        "@tanstack/react-router": {
          createFileRoute: () => (config) => ({
            ...config,
            useSearch: () => ({ authorization_id: "request" }),
          }),
        },
        "@/integrations/supabase/client": {
          resolveLegacyAuthContext: async () => {
            calls.push("resolve");
            if (denied) throw new Error("hosted_auth_unavailable");
            return context;
          },
        },
        "@/lib/kova-auth-browser": { subscribeKovaAuthChanges: () => () => {} },
        "@/components/auth/AuthDialog": { AuthDialog: "AuthDialog" },
        "@/components/NovaLogo": { NovaLogo: "Logo" },
      },
      globals: {
        window: {
          location: {
            set href(value) {
              redirects.push(value);
            },
          },
        },
      },
    },
  );
  return {
    ...f,
    get tree() {
      return f.tree;
    },
    calls,
    redirects,
    invalidate() {
      valid = false;
    },
    logout() {
      listener("SIGNED_OUT", null);
    },
  };
}

test("owned/unavailable legacy consent never loads or submits hosted authorization", async () => {
  const f = fixture({ denied: true });
  await f.flush();
  assert.equal(f.tree.props.title, "Authorization unavailable");
  assert.deepEqual(f.calls, ["resolve"]);
  assert.deepEqual(f.redirects, []);
});
test("consent sends explicit no-auto-redirect options and follows only the reviewed callback", async () => {
  const f = fixture();
  await f.flush();
  await f.click("Approve");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][1].skipBrowserRedirect, true);
  assert.deepEqual(f.redirects, ["https://client.example/callback?code=opaque"]);
  assert.ok(f.text().includes(details.redirect_uri), "the same top-level callback is reviewed");
});
test("denial returns to the same reviewed top-level redirect URI", async () => {
  const target = "https://client.example/callback?error=access_denied&state=original";
  const f = fixture({ target });
  await f.flush();
  await f.click("Cancel connection");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][1].skipBrowserRedirect, true);
  assert.deepEqual(f.redirects, [target]);
});
for (const [name, change] of [
  ["missing top-level redirect", { redirect_uri: undefined }],
  [
    "nested test-only redirect",
    { redirect_uri: undefined, client: { ...details.client, redirect_uri: details.redirect_uri } },
  ],
  ["wrong authorization", { authorization_id: "other-request" }],
  ["wrong account", { user: { ...details.user, id: "other-owner" } }],
  ["non-string redirect", { redirect_uri: [details.redirect_uri] }],
  ["HTTP redirect", { redirect_uri: "http://client.example/callback" }],
  ["credentialed redirect", { redirect_uri: "https://user:secret@client.example/callback" }],
  ["fragment redirect", { redirect_uri: "https://client.example/callback#secret" }],
  ["malformed redirect", { redirect_uri: "not-a-url" }],
])
  test(`consent rejects ${name} before submitting an irreversible decision`, async () => {
    const f = fixture({ detailResponse: { ...details, ...change } });
    await f.flush();
    const approve = f.nodes().find((n) => n.type === "button" && n.props.children === "Approve");
    if (approve) {
      approve.props.onClick();
      await f.flush();
    }
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.redirects, []);
  });
test("nested client metadata cannot replace the server-reviewed callback", async () => {
  const f = fixture({
    detailResponse: {
      ...details,
      client: { ...details.client, redirect_uri: "https://attacker.example/callback" },
    },
  });
  await f.flush();
  await f.click("Approve");
  assert.deepEqual(f.redirects, ["https://client.example/callback?code=opaque"]);
});
for (const action of ["approve", "deny"])
  test(`actual pinned SDK ${action} response drives the real consent component`, async () => {
    const requests = [];
    const target = `https://client.example/callback?${action === "approve" ? "code=opaque" : "error=access_denied"}&state=original`;
    const storageKey = `consent-contract-${action}`;
    const entries = new Map([
      [
        storageKey,
        JSON.stringify({
          access_token: "fixture-access",
          refresh_token: "fixture-refresh",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: details.user,
        }),
      ],
    ]);
    const client = createClient("https://sdk.example", "fixture-publishable", {
      auth: {
        storageKey,
        persistSession: true,
        detectSessionInUrl: false,
        autoRefreshToken: false,
        storage: {
          getItem: (key) => entries.get(key) ?? null,
          setItem: (key, value) => entries.set(key, value),
          removeItem: (key) => entries.delete(key),
        },
      },
      global: {
        fetch: async (url, init) => {
          const path = new URL(url).pathname;
          const method = init?.method ?? "GET";
          requests.push([method, path]);
          assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-access");
          if (path === "/auth/v1/oauth/authorizations/request" && method === "GET")
            return Response.json(details);
          assert.equal(path, "/auth/v1/oauth/authorizations/request/consent");
          assert.equal(method, "POST");
          assert.deepEqual(JSON.parse(init.body), { action });
          return Response.json({ redirect_url: target });
        },
      },
    });
    await client.auth.initialize();
    const f = fixture({ sdkOAuth: client.auth.oauth });
    await f.flush();
    assert.ok(f.text().includes(details.redirect_uri));
    await f.click(action === "approve" ? "Approve" : "Cancel connection");
    assert.deepEqual(f.redirects, [target]);
    assert.deepEqual(requests, [
      ["GET", "/auth/v1/oauth/authorizations/request"],
      ["POST", "/auth/v1/oauth/authorizations/request/consent"],
    ]);
    f.unmount();
  });
for (const stop of ["logout", "invalidate", "unmount"])
  test(`consent ${stop} during approval prevents a late redirect and duplicate submission`, async () => {
    const gate = defer(),
      f = fixture({ delay: gate.promise });
    await f.flush();
    const button = f.find("button", (n) => n.props.children === "Approve");
    button.props.onClick();
    button.props.onClick();
    await f.flush();
    assert.equal(f.calls.length, 1);
    f[stop]();
    gate.resolve();
    await f.flush();
    assert.deepEqual(f.redirects, []);
  });
test("details cannot implicitly redirect and an unrelated callback cannot receive a result", async () => {
  const done = fixture({ detailResponse: { redirect_url: "https://attacker.example" } });
  await done.flush();
  assert.deepEqual(done.redirects, []);
  const changed = fixture({ target: "https://attacker.example/callback?code=opaque" });
  await changed.flush();
  await changed.click("Approve");
  assert.deepEqual(changed.redirects, []);
});
