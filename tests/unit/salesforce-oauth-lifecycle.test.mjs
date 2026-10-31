import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as credentials from "../../src/integrations/salesforce-credential.server.mjs";
import * as tokenRequests from "../../src/integrations/oauth-token-request.server.mjs";
import { readProviderJsonObject } from "../../src/lib/provider-response.server.mjs";

function compile(file, modules, globals = {}) {
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("exports", "require", ...Object.keys(globals), code)(
    exports,
    (id) => {
      assert.ok(Object.hasOwn(modules, id), `Unexpected import ${id}`);
      return modules[id];
    },
    ...Object.values(globals),
  );
  return exports;
}

function fixture() {
  const profile = {
    active: true,
    organization_id: "00D000000000001",
    user_id: "005000000000001",
    preferred_username: "fixture@example.test",
    urls: { query: "https://fixture.my.salesforce.com/services/data/v67.0/query" },
  };
  const account = {
    id: "account-one",
    owner_id: "owner-one",
    provider_id: "salesforce",
    access_token_ciphertext: `encrypted:${credentials.packSalesforceCredential("access-test", profile)}`,
    refresh_token_ciphertext: "encrypted:refresh-test",
  };
  const state = {
    profile,
    account,
    calls: [],
    inserts: [],
    tokens: {
      access_token: "access-test",
      refresh_token: "refresh-test",
      scope: "openid api refresh_token",
    },
    oauth: {
      id: "state-one",
      owner_id: "owner-one",
      provider_id: "salesforce",
      nonce_hash: "hash:nonce",
      consumed_at: null,
      requested_scopes: ["openid", "api", "refresh_token"],
      return_path: "/apps",
      pkce_verifier_ciphertext: "encrypted:verifier",
    },
  };
  const db = {
    from(table) {
      const filters = [];
      let patch, upsert;
      const result = () => {
        let row =
          table === "integration_oauth_states"
            ? state.oauth
            : table === "integration_linked_accounts"
              ? state.account
              : null;
        if (upsert) row = state.account = { id: "account-one", ...upsert };
        if (row && !filters.every(([key, value]) => row[key] === value)) row = null;
        if (row && patch) Object.assign(row, patch);
        return { data: row ? { ...row } : null, error: null };
      };
      const chain = {
        select() {
          return chain;
        },
        eq(key, value) {
          if (key !== "state_hash") filters.push([key, value]);
          return chain;
        },
        is(key, value) {
          filters.push([key, value]);
          return chain;
        },
        gt() {
          return chain;
        },
        in() {
          return chain;
        },
        update(value) {
          patch = value;
          return chain;
        },
        upsert(value) {
          upsert = value;
          return chain;
        },
        insert(value) {
          state.inserts.push([table, value]);
          return Promise.resolve({ error: null });
        },
        maybeSingle() {
          return Promise.resolve(result());
        },
        single() {
          return Promise.resolve(result());
        },
        then(resolve, reject) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  const providers = compile(
    "src/integrations/oauth-providers.server.ts",
    {},
    { process: { env: {} } },
  );
  const modules = {
    "@supabase/supabase-js": { createClient: () => db },
    "./credential-vault.server": {
      sha256: async (value) => `hash:${value}`,
      encryptCredential: async (value) => `encrypted:${value}`,
      decryptCredential: async (value) => {
        assert.ok(value.startsWith("encrypted:"));
        return value.slice(10);
      },
    },
    "./oauth-providers.server": providers,
    "@/lib/oauth-security.server": { normalizeOAuthReturnPath: (value) => value },
    "@/lib/lockdown-policy.mjs": {
      assertLockdownAllows: async () => {
        if (state.lockdown) throw new Error("lockdown_mode");
      },
    },
    "./oauth-token-request.server.mjs": tokenRequests,
    "@/lib/provider-response.server.mjs": { readProviderJsonObject },
    "@/health/health-read.server.mjs": {
      confirmedHealthScopes: () => {
        assert.fail("Salesforce must not probe health data");
      },
    },
    "./salesforce-credential.server.mjs": credentials,
  };
  const lifecycle = compile("src/integrations/oauth-lifecycle.server.ts", modules, {
    process: {
      env: {
        SALESFORCE_OAUTH_CLIENT_ID: "client-test",
        SALESFORCE_OAUTH_CLIENT_SECRET: "secret-test",
      },
    },
    fetch: async (url, init) => {
      state.calls.push([url, init]);
      if (url.endsWith("/revoke")) return new Response(null, { status: state.revokeStatus ?? 200 });
      if (url.endsWith("/token")) return Response.json(state.tokens);
      assert.equal(url, credentials.SALESFORCE_PROFILE_ENDPOINT);
      return Response.json(state.profile);
    },
  });
  return { ...lifecycle, state };
}
const callback = {
  providerId: "salesforce",
  code: "code-test",
  state: "state-test",
  browserNonce: "nonce",
  request: new Request("https://kovagpt.com/api/integrations/oauth/callback/salesforce"),
};

test("Salesforce OAuth callback encrypts the verified organization binding without a fabricated expiry", async () => {
  const f = fixture();
  const result = await f.completeOAuth(callback);
  assert.equal(result.returnPath, "/apps");
  const stored = f.state.account;
  assert.equal(stored.owner_id, "owner-one");
  assert.equal(stored.provider_account_id, "00D000000000001:005000000000001");
  assert.equal(stored.token_expires_at, null);
  assert.equal(
    credentials.unpackSalesforceCredential(stored.access_token_ciphertext.slice(10)).query_url,
    f.state.profile.urls.query,
  );
  assert.equal(f.state.calls[0][1].body.get("code_verifier"), "verifier");
  assert.equal(f.state.calls[1][1].headers.Authorization, "Bearer access-test");
  await assert.rejects(f.completeOAuth(callback), /invalid_or_expired_oauth_state/);
  assert.equal(f.state.calls.length, 2);
});

test("Salesforce callback rejects unverifiable scope, browser binding and non-Salesforce instance URLs", async () => {
  for (const failure of ["scope", "browser", "url", "lockdown"]) {
    const f = fixture();
    if (failure === "scope") delete f.state.tokens.scope;
    if (failure === "browser") f.state.oauth.nonce_hash = "hash:other-browser";
    if (failure === "url")
      f.state.profile.urls.query = "https://evil.test/services/data/v67.0/query";
    if (failure === "lockdown") f.state.lockdown = true;
    await assert.rejects(
      f.completeOAuth(callback),
      /oauth_scope_verification_failed|invalid_oauth_browser_binding|invalid_salesforce_binding|lockdown_mode/,
    );
    assert.equal(f.state.account.provider_account_id, undefined);
    assert.equal(
      f.state.calls.length,
      ["browser", "lockdown"].includes(failure) ? 0 : failure === "scope" ? 1 : 2,
    );
  }
});

test("Salesforce disconnect revokes on the validated instance and erases only the owner's credential", async () => {
  for (const useRefresh of [true, false]) {
    const f = fixture();
    if (!useRefresh) f.state.account.refresh_token_ciphertext = null;
    await assert.rejects(f.disconnectOAuth("owner-two", "account-one"), /linked_account_not_found/);
    assert.equal(f.state.calls.length, 0);
    assert.deepEqual(await f.disconnectOAuth("owner-one", "account-one"), {
      providerRevoked: true,
    });
    const [url, init] = f.state.calls[0];
    assert.equal(url, "https://fixture.my.salesforce.com/services/oauth2/revoke");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    assert.equal(init.body.get("token"), useRefresh ? "refresh-test" : "access-test");
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(f.state.account.access_token_ciphertext, "deleted");
    assert.equal(f.state.account.refresh_token_ciphertext, null);
  }
});

test("failed Salesforce remote revocation remains pending while local credentials are erased", async () => {
  const f = fixture();
  f.state.revokeStatus = 503;
  assert.deepEqual(await f.disconnectOAuth("owner-one", "account-one"), { providerRevoked: false });
  assert.equal(f.state.account.access_token_ciphertext, "deleted");
  assert.equal(
    f.state.inserts.find(([table]) => table === "integration_deletion_requests")[1].status,
    "pending",
  );
});
