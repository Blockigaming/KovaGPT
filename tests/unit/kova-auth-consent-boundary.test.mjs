import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
const details = {
  client: { name: "Example", redirect_uri: "https://client.example/callback" },
  scopes: ["openid"],
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
      oauth: {
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
