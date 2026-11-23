import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as approvedMcp from "../../src/integrations/approved-mcp-servers.server.mjs";
import * as mcpReads from "../../src/integrations/mcp-provider-read.server.mjs";
import * as credentials from "../../src/integrations/salesforce-credential.server.mjs";
import * as connectionFlows from "../../src/integrations/connection-flows.mjs";
import * as tokenRequests from "../../src/integrations/oauth-token-request.server.mjs";
import { readProviderJsonObject } from "../../src/lib/provider-response.server.mjs";
import * as ouraMetrics from "../../src/health/oura-metrics.mjs";

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
    profileEndpoint: credentials.SALESFORCE_PROFILE_ENDPOINT,
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
  const env = {
    CONNECTOR_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    STRIPE_APPS_OAUTH_CLIENT_ID: "ca_Fixture",
    STRIPE_APPS_OAUTH_API_KEY: "sk_test_Fixture",
    SALESFORCE_OAUTH_CLIENT_ID: "client-test",
    SALESFORCE_OAUTH_CLIENT_SECRET: "secret-test",
    CALENDLY_OAUTH_CLIENT_ID: "client-test",
    CALENDLY_OAUTH_CLIENT_SECRET: "secret-test",
    BIGQUERY_OAUTH_CLIENT_ID: "client-test",
    BIGQUERY_OAUTH_CLIENT_SECRET: "secret-test",
    GAMMA_OAUTH_CLIENT_ID: "client-test",
    GAMMA_OAUTH_CLIENT_SECRET: "secret-test",
    HUBSPOT_OAUTH_CLIENT_ID: "client-test",
    HUBSPOT_OAUTH_CLIENT_SECRET: "secret-test",
  };
  const providers = compile(
    "src/integrations/oauth-providers.server.ts",
    {
      "./connection-flows.mjs": connectionFlows,
      "./approved-mcp-servers.server.mjs": approvedMcp,
      "@/health/oura-metrics.mjs": ouraMetrics,
    },
    { process: { env } },
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
    "./connection-flows.mjs": connectionFlows,
    "./mcp-provider-read.server.mjs": mcpReads,
    "@/lib/provider-response.server.mjs": { readProviderJsonObject },
    "@/health/health-read.server.mjs": {
      confirmedHealthScopes: () => {
        assert.fail("Salesforce must not probe health data");
      },
    },
    "./salesforce-credential.server.mjs": credentials,
  };
  const lifecycle = compile("src/integrations/oauth-lifecycle.server.ts", modules, {
    process: { env },
    fetch: async (url, init) => {
      state.calls.push([url, init]);
      if (url.endsWith("/revoke")) {
        state.onRevoke?.();
        return new Response(null, { status: state.revokeStatus ?? 200 });
      }
      if (url.endsWith("/token")) return Response.json(state.tokens);
      assert.equal(url, state.profileEndpoint);
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

test("new work-app callbacks store only a confirmed grant for the bound provider account", async () => {
  const calendlyUser = "https://api.calendly.com/users/linked-user";
  const bigqueryScope = connectionFlows.BIGQUERY_READ_SCOPE;
  const fixtures = [
    {
      providerId: "gamma",
      tokens: { scope: "gamma:read" },
      profile: { userId: "user_1", workspaceId: "workspace_2", workspaceName: "Fixture workspace" },
      profileEndpoint: "https://public-api.gamma.app/v1.0/me",
      accountId: "workspace_2:user_1",
      scopes: ["gamma:read"],
    },
    {
      providerId: "gamma",
      tokens: { scope: "generate" },
      profile: { userId: "user_1", workspaceId: "workspace_2", workspaceName: "Fixture workspace" },
      profileEndpoint: "https://public-api.gamma.app/v1.0/me",
      accountId: "workspace_2:user_1",
      scopes: ["generate"],
    },
    {
      providerId: "calendly",
      tokens: { owner: calendlyUser, scope: "users:read scheduled_events:read" },
      profile: { resource: { uri: calendlyUser, name: "Linked user" } },
      profileEndpoint: "https://api.calendly.com/users/me",
      accountId: calendlyUser,
      scopes: ["users:read", "scheduled_events:read"],
    },
    {
      providerId: "google-bigquery",
      tokens: { scope: `openid https://www.googleapis.com/auth/userinfo.email ${bigqueryScope}` },
      profile: { sub: "google-user" },
      profileEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
      accountId: "google-user",
      scopes: ["openid", "https://www.googleapis.com/auth/userinfo.email", bigqueryScope],
    },
    {
      providerId: "hubspot",
      tokens: { hub_id: 123, scopes: ["crm.objects.companies.read"] },
      accountId: "123",
      scopes: ["crm.objects.companies.read"],
    },
  ];
  for (const entry of fixtures) {
    const f = fixture();
    const { providerId, tokens, profile, profileEndpoint, accountId, scopes } = entry;
    f.state.oauth.provider_id = providerId;
    f.state.oauth.requested_scopes = scopes;
    f.state.profile = profile;
    f.state.profileEndpoint = profileEndpoint;
    f.state.tokens = {
      access_token: "access-test",
      refresh_token: "refresh-test",
      expires_in: 1800,
      ...tokens,
    };
    const request = new Request(
      `https://kovagpt.com/api/integrations/oauth/callback/${providerId}`,
    );
    await f.completeOAuth({ ...callback, providerId, request });
    assert.equal(f.state.account.provider_account_id, accountId);
    assert.equal(f.state.account.access_token_ciphertext, "encrypted:access-test");
    assert.deepEqual(f.state.account.granted_scopes, scopes);
    assert.equal(f.state.calls.length, profileEndpoint ? 2 : 1);

    f.state.oauth.consumed_at = null;
    delete f.state.tokens.scope;
    delete f.state.tokens.scopes;
    const before = f.state.account;
    await assert.rejects(
      f.completeOAuth({ ...callback, providerId, request }),
      /oauth_scope_verification_failed/,
    );
    assert.equal(f.state.account, before);
  }
});

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

test("Granola disconnect erases the owner's local key without a remote request", async () => {
  const f = fixture();
  Object.assign(f.state.account, {
    provider_id: "granola",
    workspace_id: null,
    updated_at: "old",
    deleted_at: null,
  });
  await assert.rejects(f.disconnectOAuth("other-owner", "account-one"), /linked_account_not_found/);
  assert.deepEqual(await f.disconnectOAuth("owner-one", "account-one"), { providerRevoked: false });
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.state.account.access_token_ciphertext, "deleted");
  assert.equal(f.state.account.status, "revoked");
});

test("Gamma starts authorization with the API audience, read-only scope and PKCE", async () => {
  const f = fixture();
  const result = await f.beginOAuth({
    ...callback,
    ownerId: "owner-one",
    providerId: "gamma",
    optionalScopes: [],
  });
  const url = new URL(result.url);
  assert.equal(url.origin, "https://auth.gamma.app");
  assert.equal(url.searchParams.get("resource"), "https://public-api.gamma.app");
  assert.equal(url.searchParams.get("scope"), "gamma:read");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("code_challenge"), /^[a-zA-Z0-9_-]{43}$/u);
  assert.equal(url.searchParams.has("client_secret"), false);
  const upgrade = new URL(
    (
      await f.beginOAuth({
        ...callback,
        ownerId: "owner-one",
        providerId: "gamma",
        optionalScopes: ["gamma:read", "generate"],
      })
    ).url,
  );
  assert.equal(upgrade.searchParams.get("scope"), "generate");
});

test("Tana's public client uses the production callback and rejects mismatched issuers", async () => {
  const f = fixture();
  const request = new Request("https://kovagpt.com/api/integrations/oauth/callback/tana");
  const client = JSON.parse(readFileSync("public/.well-known/tana-mcp-client.json", "utf8"));
  const args = { ...callback, ownerId: "owner-one", providerId: "tana", request };
  const launch = new URL((await f.beginOAuth(args)).url);
  assert.equal(launch.origin + launch.pathname, connectionFlows.TANA_MCP_AUTHORIZE_ENDPOINT);
  assert.equal(launch.searchParams.get("client_id"), client.client_id);
  assert.deepEqual(client.redirect_uris, [launch.searchParams.get("redirect_uri")]);
  assert.equal(launch.searchParams.get("resource"), connectionFlows.TANA_MCP_RESOURCE);
  assert.equal(launch.searchParams.get("scope"), client.scope);
  assert.equal(launch.searchParams.get("code_challenge_method"), "S256");
  assert.equal(client.token_endpoint_auth_method, "none");
  await assert.rejects(
    f.beginOAuth({
      ...args,
      request: new Request("https://other.example/api/integrations/oauth/start"),
    }),
    /provider_not_configured/,
  );
  await assert.rejects(
    f.completeOAuth({ ...args, issuer: "https://home.tana.inc" }),
    /oauth_issuer_mismatch/,
  );
  assert.deepEqual(f.state.calls, []);
  Object.assign(f.state.account, {
    provider_id: "tana",
    refresh_token_ciphertext: "encrypted:refresh-test",
    workspace_id: null,
    deleted_at: null,
    updated_at: "old",
  });
  assert.deepEqual(await f.disconnectOAuth("owner-one", "account-one"), { providerRevoked: true });
  const [[url, init]] = f.state.calls;
  assert.equal(url, "https://login.tana.inc/oauth2/revoke");
  assert.deepEqual(Object.fromEntries(init.body), {
    token: "refresh-test",
    client_id: client.client_id,
  });
  assert.equal(init.redirect, "error");
});

test("a Tana disconnect cannot erase a newer grant created while revocation is in flight", async () => {
  const f = fixture();
  Object.assign(f.state.account, {
    provider_id: "tana",
    workspace_id: null,
    deleted_at: null,
    updated_at: "old",
  });
  f.state.onRevoke = () =>
    Object.assign(f.state.account, {
      access_token_ciphertext: "encrypted:new-grant",
      updated_at: "new",
    });
  await assert.rejects(
    f.disconnectOAuth("owner-one", "account-one"),
    /linked_account_purge_failed/,
  );
  assert.equal(f.state.account.access_token_ciphertext, "encrypted:new-grant");
});

test("Stripe validates the mode and actual charge permissions before saving an app grant", async () => {
  const request = new Request("https://kovagpt.com/api/integrations/oauth/callback/stripe");
  for (const failure of [null, "mode", "permission"]) {
    const f = fixture();
    f.state.oauth.provider_id = "stripe";
    f.state.oauth.requested_scopes = ["stripe_apps"];
    f.state.tokens = {
      access_token: "stripe-access-fixture",
      refresh_token: "stripe-refresh-fixture",
      token_type: "bearer",
      livemode: failure === "mode",
      stripe_user_id: "acct_Fixture",
      scope: "stripe_apps",
    };
    f.state.profile =
      failure === "permission" ? { error: {} } : { object: "list", url: "/v1/charges", data: [] };
    f.state.profileEndpoint = "https://api.stripe.com/v1/charges?limit=1";
    const complete = () => f.completeOAuth({ ...callback, providerId: "stripe", request });
    if (failure === "mode") {
      await assert.rejects(complete(), /oauth_profile_identity_mismatch/);
      assert.equal(f.state.calls.length, 1);
    } else if (failure === "permission") {
      await assert.rejects(complete(), /oauth_profile_failed/);
    } else {
      await complete();
      assert.equal(f.state.account.provider_account_id, "test:acct_Fixture");
      assert.equal(f.state.account.account_label, "Stripe test account");
      assert.equal(f.state.account.access_token_ciphertext, "encrypted:stripe-access-fixture");
    }
    if (failure) assert.equal(f.state.account.provider_id, "salesforce");
  }
});
