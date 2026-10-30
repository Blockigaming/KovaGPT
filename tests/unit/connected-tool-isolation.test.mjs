import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as flows from "../../src/integrations/connection-flows.mjs";
import * as tokenRequests from "../../src/integrations/oauth-token-request.server.mjs";
import { readProviderJsonObject } from "../../src/lib/provider-response.server.mjs";

function fixture() {
  const row = {
    id: "00000000-0000-4000-8000-000000000001",
    owner_id: "owner-a",
    provider_id: "microsoft",
    workspace_id: null,
    account_label: "test account",
    status: "connected",
    granted_scopes: ["Mail.Read"],
    token_expires_at: null,
    updated_at: "2026-10-30T00:00:00Z",
    deleted_at: null,
    access_token_ciphertext: "encrypted-test",
  };
  const calls = [];
  const state = {
    row,
    rows: [row],
    lockdown: false,
    allowRate: true,
    reads: 0,
    decrypts: 0,
    configured: true,
  };
  const db = {
    from(table) {
      const filters = [];
      let patch;
      const chain = {
        select(value) {
          calls.push([table, "select", value]);
          return chain;
        },
        update(value) {
          patch = value;
          return chain;
        },
        eq(key, value) {
          filters.push([key, value]);
          calls.push([table, "eq", key, value]);
          return chain;
        },
        is(key, value) {
          filters.push([key, value]);
          calls.push([table, "is", key, value]);
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        insert(value) {
          calls.push([table, "insert", value]);
          return Promise.resolve({ error: null });
        },
        maybeSingle() {
          const matches = state.row && filters.every(([key, value]) => state.row[key] === value);
          if (matches && patch) state.row = { ...state.row, ...patch };
          return Promise.resolve({ data: matches ? { ...state.row } : null, error: null });
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: state.rows.filter((row) => filters.every(([key, value]) => row[key] === value)),
            error: null,
          }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  const modules = {
    "@/lib/github-chat-tools.server": {
      githubChatTools: {
        getContext: async () => {
          if (state.githubUnavailable) throw new Error("github_read_context_unavailable");
          return state.githubContext ?? { tools: [] };
        },
        run: async (...args) => {
          calls.push(["github_read", ...args]);
          return { service: "GitHub", content: "fixture source" };
        },
      },
    },
    "@/integrations/supabase/client.server": { supabaseAdmin: db },
    "@/lib/lockdown-policy.mjs": {
      assertLockdownAllows: async (_db, owner, capability) => {
        calls.push(["lockdown", owner, capability]);
        if (state.lockdown) throw new Error("lockdown_mode");
      },
    },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: state.allowRate, status: "limited" }),
    },
    "./connection-flows.mjs": flows,
    "./oauth-providers.server": {
      configuredOAuthProviders: () => (state.configured ? [{ id: "microsoft" }] : []),
      OAUTH_PROVIDERS: {
        microsoft: {
          id: "microsoft",
          tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
          clientIdEnv: "TEST_ID",
          clientSecretEnv: "TEST_SECRET",
        },
      },
    },
    "./credential-vault.server": {
      decryptCredential: async () => {
        state.decrypts += 1;
        return "fake-token";
      },
      encryptCredential: async (value) => `encrypted:${value}`,
    },
    "./connection-read.server.mjs": {
      readConnection: async (id, query, token) => {
        state.reads += 1;
        calls.push(["read", id, query, token]);
        return { results: [{ title: "test result" }] };
      },
    },
    "./oauth-token-request.server.mjs": tokenRequests,
    "@/lib/provider-response.server.mjs": { readProviderJsonObject },
  };
  const source = ts.transpileModule(
    readFileSync("src/integrations/connected-tools.server.ts", "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const exported = {};
  new Function("exports", "require", "fetch", "process", source)(
    exported,
    (id) => {
      assert.ok(Object.hasOwn(modules, id), id);
      return modules[id];
    },
    async () => {
      state.refreshCalls = (state.refreshCalls ?? 0) + 1;
      await state.onFetch?.();
      return (
        state.fetchResponse ??
        Response.json({
          access_token: "renewed",
          refresh_token: "rotated",
          expires_in: 3600,
          scope: "Mail.Read",
        })
      );
    },
    { env: { TEST_ID: "fake-client", TEST_SECRET: "fake-secret" } },
  );
  return { ...exported, state, calls };
}

test("chat merges GitHub repository tools and dispatches through its pinned context", async () => {
  const f = fixture();
  f.state.githubContext = {
    ownerId: "owner-a",
    repositories: [],
    tools: [
      {
        type: "function",
        function: { name: "github_read", parameters: {}, description: "fixture" },
      },
    ],
  };
  const context = await f.getConnectedToolContext("owner-a");
  assert.deepEqual(
    context.tools.map((tool) => tool.function.name),
    ["outlook_search", "github_read"],
  );
  const args = { repository: "owner/repo", operation: "readme" };
  const result = await f.runConnectedTool("owner-a", "github_read", args, context);
  assert.equal(result.content, "fixture source");
  assert.deepEqual(f.calls.find((call) => call[0] === "github_read").slice(1), [
    "owner-a",
    "github_read",
    args,
    f.state.githubContext,
  ]);
  assert.equal(f.state.decrypts, 0);
  f.state.lockdown = true;
  await assert.rejects(
    f.runConnectedTool("owner-a", "github_read", args, context),
    /lockdown_mode/,
  );
  assert.equal(f.calls.filter((call) => call[0] === "github_read").length, 1);
});

test("unavailable GitHub context preserves other provider tools and cannot be invoked", async () => {
  const f = fixture();
  f.state.githubUnavailable = true;
  const context = await f.getConnectedToolContext("owner-a");
  assert.deepEqual(
    context.tools.map((tool) => tool.function.name),
    ["outlook_search"],
  );
  await assert.rejects(
    f.runConnectedTool("owner-a", "github_read", {}, context),
    /github_read_not_allowed/,
  );
  assert.equal(f.state.decrypts, 0);
});

test("tool planning offers only actually granted service reads and pins account IDs", async () => {
  const f = fixture();
  const context = await f.getConnectedToolContext("owner-a");
  assert.deepEqual(
    context.tools.map((tool) => tool.function.name),
    ["outlook_search"],
  );
  assert.deepEqual(context.tools[0].function.parameters.properties.account_id.enum, [
    f.state.row.id,
  ]);
  const result = await f.runConnectedTool(
    "owner-a",
    "outlook_search",
    { account_id: f.state.row.id, query: "hello" },
    context,
  );
  assert.equal(result.results[0].title, "test result");
  assert.equal(f.state.reads, 1);
  const query = f.calls.filter((call) => call[0] === "integration_linked_accounts");
  assert.ok(
    query.some((call) => call[1] === "eq" && call[2] === "owner_id" && call[3] === "owner-a"),
  );
  assert.ok(
    query.some((call) => call[1] === "is" && call[2] === "workspace_id" && call[3] === null),
  );
  assert.ok(f.calls.some((call) => call[0] === "integration_audit_events" && call[1] === "insert"));
});

test("another owner or an arbitrary model-selected account never reaches credentials", async () => {
  for (const change of ["owner", "account", "tool"]) {
    const f = fixture(),
      context = await f.getConnectedToolContext("owner-a");
    await assert.rejects(
      f.runConnectedTool(
        change === "owner" ? "owner-b" : "owner-a",
        change === "tool" ? "onedrive_search" : "outlook_search",
        { account_id: change === "account" ? "another-account" : f.state.row.id, query: "hello" },
        context,
      ),
      /connection_/,
    );
    assert.equal(f.state.decrypts, 0);
    assert.equal(f.state.reads, 0);
  }
});

test("revocation, expiry, changed scopes or reconnect after planning stop execution", async () => {
  for (const patch of [
    { status: "revoked" },
    { deleted_at: "2026-10-30T01:00:00Z" },
    { token_expires_at: "2000-01-01T00:00:00Z" },
    { granted_scopes: [] },
    { updated_at: "2026-10-30T02:00:00Z" },
  ]) {
    const f = fixture(),
      context = await f.getConnectedToolContext("owner-a");
    f.state.row = { ...f.state.row, ...patch };
    await assert.rejects(
      f.runConnectedTool(
        "owner-a",
        "outlook_search",
        { account_id: context.accounts[0].id, query: "hello" },
        context,
      ),
      /connection_changed_or_expired/,
    );
    assert.equal(f.state.decrypts, 0);
  }
});

test("Lockdown and unavailable request protection prevent outbound reads", async () => {
  for (const control of ["lockdown", "rate"]) {
    const f = fixture(),
      context = await f.getConnectedToolContext("owner-a");
    if (control === "lockdown") f.state.lockdown = true;
    else f.state.allowRate = false;
    await assert.rejects(
      f.runConnectedTool(
        "owner-a",
        "outlook_search",
        { account_id: f.state.row.id, query: "hello" },
        context,
      ),
    );
    assert.equal(f.state.decrypts, 0);
    assert.equal(f.state.reads, 0);
  }
});

test("workspace accounts and unconfigured providers are never offered as personal reads", async () => {
  const f = fixture();
  f.state.configured = false;
  assert.equal((await f.getConnectedToolContext("owner-a")).tools.length, 0);
  f.state.configured = true;
  f.state.row.workspace_id = "workspace-one";
  assert.equal((await f.getConnectedToolContext("owner-a")).tools.length, 0);
});

test("concurrent token refreshes claim a credential only once and persist the rotated pair", async () => {
  const f = fixture();
  f.state.row.token_expires_at = new Date(Date.now() + 1000).toISOString();
  f.state.row.refresh_token_ciphertext = "old-refresh";
  const { id, updated_at } = f.state.row;
  const results = await Promise.all([
    f.refreshExpiringConnection("owner-a", id, updated_at),
    f.refreshExpiringConnection("owner-a", id, updated_at),
  ]);
  assert.equal(f.state.refreshCalls, 1);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(f.state.row.status, "connected");
  assert.equal(f.state.row.access_token_ciphertext, "encrypted:renewed");
  assert.equal(f.state.row.refresh_token_ciphertext, "encrypted:rotated");
});

test("uncertain token rotation is not replayed and cannot replace a newer reconnect", async () => {
  for (const failure of ["response", "disconnect", "reconnect"]) {
    const f = fixture();
    f.state.row.token_expires_at = new Date(Date.now() + 1000).toISOString();
    f.state.row.refresh_token_ciphertext = "old-refresh";
    const { id, updated_at } = f.state.row;
    if (failure === "response")
      f.state.fetchResponse = new Response("private error", { status: 500 });
    if (failure === "disconnect")
      f.state.onFetch = () => {
        f.state.row = { ...f.state.row, deleted_at: new Date().toISOString(), status: "revoked" };
      };
    if (failure === "reconnect")
      f.state.onFetch = () => {
        f.state.row = {
          ...f.state.row,
          updated_at: "new-reconnect",
          status: "connected",
          access_token_ciphertext: "new-connection-token",
        };
      };
    assert.equal(await f.refreshExpiringConnection("owner-a", id, updated_at), null);
    assert.equal(await f.refreshExpiringConnection("owner-a", id, updated_at), null);
    assert.equal(f.state.refreshCalls, 1);
    if (failure === "reconnect")
      assert.equal(f.state.row.access_token_ciphertext, "new-connection-token");
    if (failure === "response") assert.equal(f.state.row.status, "expired");
  }
});
