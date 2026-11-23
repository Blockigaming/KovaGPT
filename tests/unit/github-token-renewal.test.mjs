import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { readProviderJsonObject } from "../../src/lib/provider-response.server.mjs";

const compiled = ts.transpileModule(readFileSync("src/lib/github-oauth.server.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

async function fixture() {
  const requests = [];
  const row = {
    id: "github-a",
    owner_id: "owner-a",
    auth_type: "oauth",
    github_user_id: 42,
    status: "connected",
    token_expires_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  };
  const state = { profileId: 42, beforeProfile: () => {} };
  const db = {
    from(table) {
      assert.equal(table, "github_accounts");
      const filters = [];
      let update;
      const query = {
        select: () => query,
        eq(key, value) {
          filters.push([key, value]);
          return query;
        },
        update(values) {
          update = values;
          return query;
        },
        async maybeSingle() {
          if (!filters.every(([key, value]) => row[key] === value))
            return { data: null, error: null };
          if (update) Object.assign(row, update);
          return { data: { ...row }, error: null };
        },
      };
      return query;
    },
  };
  const dependencies = {
    "node:crypto": await import("node:crypto"),
    "@/integrations/supabase/client.server": { supabaseAdmin: db },
    "@/lib/lockdown-policy.mjs": { assertLockdownAllows: async () => {} },
    "@/lib/provider-response.server.mjs": { readProviderJsonObject },
  };
  const helper = {};
  new Function("exports", "require", "process", "fetch", compiled)(
    helper,
    (name) => dependencies[name],
    {
      env: {
        GITHUB_OAUTH_CLIENT_ID: "test-client",
        GITHUB_OAUTH_CLIENT_SECRET: "test-secret",
        CONNECTOR_ENCRYPTION_KEY: "isolated-test-encryption-key",
      },
    },
    async (url, options) => {
      requests.push([url, options]);
      assert.equal(options.redirect, "error");
      if (url === "https://github.com/login/oauth/access_token") {
        assert.equal(options.method, "POST");
        assert.equal(options.body.get("grant_type"), "refresh_token");
        assert.equal(options.body.get("refresh_token"), "old-refresh");
        assert.equal(options.body.has("scope"), false);
        return Response.json({
          access_token: "new-token",
          refresh_token: "new-refresh",
          expires_in: 28800,
        });
      }
      assert.equal(url, "https://api.github.com/user");
      assert.equal(options.headers.Authorization, "Bearer new-token");
      state.beforeProfile();
      return Response.json({ id: state.profileId });
    },
  );
  row.token_ciphertext = await helper.encryptSecret("old-token");
  row.refresh_token_ciphertext = await helper.encryptSecret("old-refresh");
  return { ...helper, requests, row, state };
}

test("GitHub rotates an expired user token once and preserves the verified owner account", async () => {
  const t = await fixture();
  assert.equal(await t.renewGitHubOAuthAccount("other-owner", "github-a"), null);
  assert.equal(t.requests.length, 0);

  const candidates = await Promise.all([
    t.renewGitHubOAuthAccount("owner-a", "github-a"),
    t.renewGitHubOAuthAccount("owner-a", "github-a"),
  ]);
  assert.equal(candidates.filter(Boolean).length, 1);
  assert.equal(t.requests.length, 2);
  assert.equal(t.row.status, "connected");
  assert.equal(t.gitHubTokenCurrent(t.row.token_expires_at), true);
  assert.equal(await t.decryptSecret(t.row.token_ciphertext), "new-token");
  assert.equal(await t.decryptSecret(t.row.refresh_token_ciphertext), "new-refresh");
  assert.equal((await t.renewGitHubOAuthAccount("owner-a", "github-a")).id, "github-a");
  assert.equal(t.requests.length, 2);
});

test("GitHub never saves a renewed grant for a different identity or an intervening reconnect", async () => {
  const wrong = await fixture();
  wrong.state.profileId = 7;
  assert.equal(await wrong.renewGitHubOAuthAccount("owner-a", "github-a"), null);
  assert.equal(wrong.row.status, "reauthorization_required");
  assert.equal(await wrong.renewGitHubOAuthAccount("owner-a", "github-a"), null);
  assert.equal(wrong.requests.length, 2);

  const raced = await fixture();
  const reconnected = await raced.encryptSecret("new-connection");
  raced.state.beforeProfile = () => {
    Object.assign(raced.row, {
      status: "connected",
      token_ciphertext: reconnected,
      updated_at: "2024-02-01T00:00:00Z",
    });
  };
  assert.equal(await raced.renewGitHubOAuthAccount("owner-a", "github-a"), null);
  assert.equal(raced.row.token_ciphertext, reconnected);
});
