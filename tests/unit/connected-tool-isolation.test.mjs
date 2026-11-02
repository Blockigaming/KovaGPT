import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as flows from "../../src/integrations/connection-flows.mjs";
import * as salesforceCredentials from "../../src/integrations/salesforce-credential.server.mjs";
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
      let columns = "*";
      const project = (row) =>
        columns === "*"
          ? { ...row }
          : Object.fromEntries(columns.split(",").map((key) => [key, row[key]]));
      const chain = {
        select(value) {
          columns = value;
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
          return Promise.resolve().then(async () => {
            if (table === "integration_audit_events") await state.onAudit?.();
            return { error: state.auditError ?? null };
          });
        },
        maybeSingle() {
          const matches = state.row && filters.every(([key, value]) => state.row[key] === value);
          if (matches && patch) state.row = { ...state.row, ...patch };
          return Promise.resolve({ data: matches ? project(state.row) : null, error: null });
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: state.rows
              .filter((row) => filters.every(([key, value]) => row[key] === value))
              .map(project),
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
      configuredOAuthProviders: () => (state.configured ? [{ id: state.row.provider_id }] : []),
      OAUTH_PROVIDERS: {
        notion: {
          id: "notion",
          tokenEndpoint: "https://api.notion.com/v1/oauth/token",
          clientIdEnv: "TEST_ID",
          clientSecretEnv: "TEST_SECRET",
        },
        salesforce: {
          id: "salesforce",
          tokenEndpoint: "https://login.salesforce.com/services/oauth2/token",
          clientIdEnv: "TEST_ID",
          clientSecretEnv: "TEST_SECRET",
        },
        microsoft: {
          id: "microsoft",
          tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
          clientIdEnv: "TEST_ID",
          clientSecretEnv: "TEST_SECRET",
        },
      },
    },
    "./credential-vault.server": {
      decryptCredential: async (ciphertext) => {
        state.decrypts += 1;
        await state.onDecrypt?.();
        return ciphertext.startsWith("encrypted:") ? ciphertext.slice(10) : "fake-token";
      },
      encryptCredential: async (value) => `encrypted:${value}`,
    },
    "./connection-read.server.mjs": {
      readConnection: async (id, query, token, _fetch, options) => {
        state.reads += 1;
        calls.push(["read", id, query, token, options]);
        await state.onRead?.();
        return { results: [{ title: "test result" }] };
      },
    },
    "./salesforce-credential.server.mjs": salesforceCredentials,
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
    async (url, init) => {
      calls.push(["fetch", url, init]);
      state.refreshCalls = (state.refreshCalls ?? 0) + 1;
      const response = await state.onFetch?.(url, init);
      if (response) return response;
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

for (const [name, patch] of [
  ["revoked status", { status: "revoked" }],
  ["deleted account", { deleted_at: "2026-10-30T01:00:00Z" }],
  ["expired token", { token_expires_at: "2000-01-01T00:00:00Z" }],
  ["removed scopes", { granted_scopes: [] }],
  ["reconnected version", { updated_at: "new-reconnect" }],
  ["rotated credential without version", { access_token_ciphertext: "other-token" }],
  ["changed owner", { owner_id: "owner-b" }],
  ["moved workspace", { workspace_id: "workspace-one" }],
]) {
  test(`in-flight ${name} discards provider data and cannot report a successful read`, async () => {
    const f = fixture(),
      context = await f.getConnectedToolContext("owner-a");
    f.state.onRead = () => {
      f.state.row = { ...f.state.row, ...patch };
    };
    await assert.rejects(
      f.runConnectedTool(
        "owner-a",
        "outlook_search",
        { account_id: f.state.row.id, query: "hello" },
        context,
      ),
      /connection_changed_or_expired/,
    );
    assert.equal(f.state.reads, 1);
    assert.equal(
      f.calls.filter((call) => call[0] === "integration_audit_events" && call[1] === "insert")
        .length,
      0,
    );
  });
}

test("Lockdown and provider disablement during decryption, the request or audit withhold data", async () => {
  for (const stage of ["onDecrypt", "onRead", "onAudit"]) {
    for (const control of ["lockdown", "configured"]) {
      const f = fixture(),
        context = await f.getConnectedToolContext("owner-a");
      f.state[stage] = () => {
        f.state[control] = control === "lockdown";
      };
      await assert.rejects(
        f.runConnectedTool(
          "owner-a",
          "outlook_search",
          { account_id: f.state.row.id, query: "hello" },
          context,
        ),
        /lockdown_mode|connection_changed_or_expired/,
      );
      assert.equal(f.state.reads, stage === "onDecrypt" ? 0 : 1);
    }
  }
});

test("a changed credential while decryption is pending cannot reach the provider", async () => {
  const f = fixture(),
    context = await f.getConnectedToolContext("owner-a");
  f.state.onDecrypt = () => {
    f.state.row.access_token_ciphertext = "replaced";
  };
  await assert.rejects(
    f.runConnectedTool(
      "owner-a",
      "outlook_search",
      { account_id: f.state.row.id, query: "hello" },
      context,
    ),
    /connection_changed_or_expired/,
  );
  assert.equal(f.state.reads, 0);
});

test("a revocation during audit and an unavailable audit both withhold provider results", async () => {
  for (const failure of ["revocation", "audit"]) {
    const f = fixture(),
      context = await f.getConnectedToolContext("owner-a");
    if (failure === "revocation")
      f.state.onAudit = () => {
        f.state.row.status = "revoked";
      };
    else f.state.auditError = { message: "private database diagnostic" };
    await assert.rejects(
      f.runConnectedTool(
        "owner-a",
        "outlook_search",
        { account_id: f.state.row.id, query: "hello" },
        context,
      ),
      /connection_changed_or_expired|connection_audit_unavailable/,
    );
    assert.equal(f.state.reads, 1);
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

function salesforceFixture() {
  const f = fixture();
  const profile = {
    active: true,
    organization_id: "00D000000000001",
    user_id: "005000000000001",
    urls: { query: "https://fixture.my.salesforce.com/services/data/v67.0/query" },
  };
  Object.assign(f.state.row, {
    provider_id: "salesforce",
    granted_scopes: ["api", "refresh_token", "openid"],
    access_token_ciphertext: `encrypted:${salesforceCredentials.packSalesforceCredential("old-token", profile)}`,
    refresh_token_ciphertext: "encrypted:old-refresh",
    token_expires_at: null,
  });
  f.state.onFetch = (url) =>
    url === salesforceCredentials.SALESFORCE_PROFILE_ENDPOINT
      ? Response.json(profile)
      : Response.json({ access_token: "renewed-token", scope: "api refresh_token openid" });
  return f;
}

test("Salesforce chat requires an explicit record type before reading or decrypting", async () => {
  const f = salesforceFixture();
  const context = await f.getConnectedToolContext("owner-a");
  assert.deepEqual(context.tools[0].function.parameters.required, [
    "account_id",
    "query",
    "record_type",
  ]);
  for (const record_type of [undefined, "User", "__proto__"])
    await assert.rejects(
      f.runConnectedTool(
        "owner-a",
        "salesforce_search",
        { account_id: f.state.row.id, query: "name", record_type },
        context,
      ),
      /invalid_salesforce_record_type/,
    );
  assert.equal(f.state.decrypts, 0);
  assert.equal(f.state.reads, 0);
});

test("Salesforce refreshes only after a rejected read and pins the renewed identity for a single retry", async () => {
  const f = salesforceFixture();
  const context = await f.getConnectedToolContext("owner-a");
  assert.equal(f.state.refreshCalls ?? 0, 0);
  f.state.onRead = () => {
    if (f.state.reads === 1) throw new Error("connection_reauthorization_required");
  };
  const result = await f.runConnectedTool(
    "owner-a",
    "salesforce_search",
    { account_id: f.state.row.id, query: "name", record_type: "opportunities" },
    context,
  );
  assert.equal(result.results.length, 1);
  assert.equal(f.state.reads, 2);
  assert.equal(f.state.refreshCalls, 2, "one token exchange and one identity verification");
  const requests = f.calls.filter((call) => call[0] === "fetch");
  assert.equal(requests[0][1], "https://fixture.my.salesforce.com/services/oauth2/token");
  assert.equal(requests[0][2].body.get("refresh_token"), "old-refresh");
  assert.equal(f.state.row.token_expires_at, null);
  assert.equal(f.state.row.refresh_token_ciphertext, "encrypted:old-refresh");
  const reads = f.calls.filter((call) => call[0] === "read");
  assert.equal(
    salesforceCredentials.unpackSalesforceCredential(reads[1][3]).access_token,
    "renewed-token",
  );
  assert.deepEqual(reads[1][4], { recordType: "opportunities" });
  assert.equal(context.accounts[0].updated_at, f.state.row.updated_at);
  assert.equal("access_token_ciphertext" in context.accounts[0], false);
});

test("a repeated Salesforce rejection is not retried or reported as a successful read", async () => {
  const f = salesforceFixture();
  const context = await f.getConnectedToolContext("owner-a");
  f.state.onRead = () => {
    throw new Error("connection_reauthorization_required");
  };
  await assert.rejects(
    f.runConnectedTool(
      "owner-a",
      "salesforce_search",
      { account_id: f.state.row.id, query: "name", record_type: "accounts" },
      context,
    ),
    /connection_reauthorization_required/,
  );
  assert.equal(f.state.reads, 2);
  assert.equal(f.state.refreshCalls, 2);
  assert.equal(
    f.calls.filter((call) => call[0] === "integration_audit_events" && call[1] === "insert").length,
    0,
  );
});

for (const stage of ["onDecrypt", "onFetch"]) {
  test(`Salesforce ${stage} disconnect prevents token replacement or retried data`, async () => {
    const f = salesforceFixture();
    const context = await f.getConnectedToolContext("owner-a");
    f.state.onRead = () => {
      throw new Error("connection_reauthorization_required");
    };
    if (stage === "onDecrypt")
      f.state.onDecrypt = () => {
        if (f.state.row.status === "expired") f.state.row.deleted_at = "now";
      };
    else
      f.state.onFetch = () => {
        f.state.row = {
          ...f.state.row,
          status: "connected",
          updated_at: "reconnected",
          access_token_ciphertext: "new-owner-bound-credential",
        };
        return Response.json({ access_token: "must-not-store", scope: "api" });
      };
    await assert.rejects(
      f.runConnectedTool(
        "owner-a",
        "salesforce_search",
        { account_id: f.state.row.id, query: "name", record_type: "contacts" },
        context,
      ),
      /connection_reauthorization_required/,
    );
    assert.equal(f.state.reads, 1);
    assert.equal(f.state.refreshCalls ?? 0, stage === "onDecrypt" ? 0 : 1);
    assert.doesNotMatch(f.state.row.access_token_ciphertext, /must-not-store/);
  });
}

test("forced Salesforce renewal cannot read another owner or a workspace credential", async () => {
  for (const patch of [
    { owner_id: "owner-b" },
    { workspace_id: "workspace-a" },
    { deleted_at: "now" },
  ]) {
    const f = salesforceFixture();
    Object.assign(f.state.row, patch);
    assert.equal(
      await f.refreshExpiringConnection("owner-a", f.state.row.id, f.state.row.updated_at, true),
      null,
    );
    assert.equal(f.state.decrypts, 0);
    assert.equal(f.state.refreshCalls ?? 0, 0);
  }
});

function notionFixture() {
  const f = fixture();
  Object.assign(f.state.row, {
    provider_id: "notion",
    granted_scopes: [],
    access_token_ciphertext: "encrypted:old-notion-access",
    refresh_token_ciphertext: "encrypted:old-notion-refresh",
    token_expires_at: null,
  });
  f.state.onFetch = () =>
    Response.json({
      access_token: "renewed-notion-access",
      refresh_token: "rotated-notion-refresh",
    });
  return f;
}

test("Notion renews a rejected read once with Basic JSON and retains the rotated pair", async () => {
  const f = notionFixture();
  const context = await f.getConnectedToolContext("owner-a");
  assert.equal(f.state.refreshCalls ?? 0, 0);
  f.state.onRead = () => {
    if (f.state.reads === 1) throw new Error("connection_reauthorization_required");
  };
  const result = await f.runConnectedTool(
    "owner-a",
    "notion_search",
    { account_id: f.state.row.id, query: "example" },
    context,
  );
  assert.equal(result.results.length, 1);
  assert.equal(f.state.reads, 2);
  assert.equal(f.state.refreshCalls, 1);
  const request = f.calls.find((call) => call[0] === "fetch");
  assert.equal(request[1], "https://api.notion.com/v1/oauth/token");
  assert.equal(request[2].headers["Content-Type"], "application/json");
  assert.equal(
    request[2].headers.Authorization,
    "Basic " + Buffer.from("fake-client:fake-secret").toString("base64"),
  );
  assert.deepEqual(JSON.parse(request[2].body), {
    grant_type: "refresh_token",
    refresh_token: "old-notion-refresh",
  });
  assert.equal(f.state.row.token_expires_at, null);
  assert.equal(f.state.row.access_token_ciphertext, "encrypted:renewed-notion-access");
  assert.equal(f.state.row.refresh_token_ciphertext, "encrypted:rotated-notion-refresh");
  assert.deepEqual(f.state.row.granted_scopes, []);
  const reads = f.calls.filter((call) => call[0] === "read");
  assert.equal(reads[0][3], "old-notion-access");
  assert.equal(reads[1][3], "renewed-notion-access");
  assert.equal(context.accounts[0].updated_at, f.state.row.updated_at);
  assert.doesNotMatch(JSON.stringify(context), /renewed-notion-access|rotated-notion-refresh/);
});

test("a second Notion rejection stops without another refresh or success audit", async () => {
  const f = notionFixture();
  const context = await f.getConnectedToolContext("owner-a");
  f.state.onRead = () => {
    throw new Error("connection_reauthorization_required");
  };
  await assert.rejects(
    f.runConnectedTool(
      "owner-a",
      "notion_search",
      { account_id: f.state.row.id, query: "example" },
      context,
    ),
    /connection_reauthorization_required/,
  );
  assert.equal(f.state.reads, 2);
  assert.equal(f.state.refreshCalls, 1);
  assert.equal(
    f.calls.filter((call) => call[0] === "integration_audit_events" && call[1] === "insert").length,
    0,
  );
});

test("Notion permission, rate-limit and ordinary provider errors never rotate tokens", async () => {
  for (const message of [
    "connection_permission_required",
    "connection_rate_limited",
    "connection_read_failed",
  ]) {
    const f = notionFixture();
    const context = await f.getConnectedToolContext("owner-a");
    f.state.onRead = () => {
      throw new Error(message);
    };
    await assert.rejects(
      f.runConnectedTool(
        "owner-a",
        "notion_search",
        { account_id: f.state.row.id, query: "example" },
        context,
      ),
      (error) => error.message === message,
    );
    assert.equal(f.state.reads, 1);
    assert.equal(f.state.refreshCalls ?? 0, 0);
    assert.equal(f.state.row.access_token_ciphertext, "encrypted:old-notion-access");
  }
});

test("concurrent rejected Notion reads claim only one token rotation", async () => {
  const f = notionFixture();
  const contexts = [
    await f.getConnectedToolContext("owner-a"),
    await f.getConnectedToolContext("owner-a"),
  ];
  f.state.onRead = () => {
    const read = f.calls.filter((call) => call[0] === "read").at(-1);
    if (read[3] === "old-notion-access") throw new Error("connection_reauthorization_required");
  };
  const results = await Promise.allSettled(
    contexts.map((context) =>
      f.runConnectedTool(
        "owner-a",
        "notion_search",
        { account_id: f.state.row.id, query: "example" },
        context,
      ),
    ),
  );
  assert.equal(f.state.refreshCalls, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(f.state.row.refresh_token_ciphertext, "encrypted:rotated-notion-refresh");
});

test("a missing Notion rotation token fails closed and is not exchanged twice", async () => {
  const f = notionFixture();
  const context = await f.getConnectedToolContext("owner-a");
  f.state.onRead = () => {
    throw new Error("connection_reauthorization_required");
  };
  f.state.onFetch = () => Response.json({ access_token: "must-not-store" });
  await assert.rejects(
    f.runConnectedTool(
      "owner-a",
      "notion_search",
      { account_id: f.state.row.id, query: "example" },
      context,
    ),
    /connection_reauthorization_required/,
  );
  assert.equal(f.state.reads, 1);
  assert.equal(f.state.refreshCalls, 1);
  assert.equal(f.state.row.status, "expired");
  assert.equal(f.state.row.access_token_ciphertext, "encrypted:old-notion-access");
  assert.equal(
    await f.refreshExpiringConnection("owner-a", f.state.row.id, f.state.row.updated_at, true),
    null,
  );
  assert.equal(f.state.refreshCalls, 1);
});

test("Notion disconnect, reconnect and Lockdown changes during rotation withhold results", async () => {
  for (const change of ["disconnect", "reconnect", "lockdown", "disabled"]) {
    const f = notionFixture();
    const context = await f.getConnectedToolContext("owner-a");
    f.state.onRead = () => {
      throw new Error("connection_reauthorization_required");
    };
    f.state.onFetch = () => {
      if (change === "disconnect") f.state.row.deleted_at = "now";
      if (change === "reconnect")
        Object.assign(f.state.row, {
          status: "connected",
          updated_at: "new-reconnect",
          access_token_ciphertext: "new-owner-bound-credential",
        });
      if (change === "lockdown") f.state.lockdown = true;
      if (change === "disabled") f.state.configured = false;
      return Response.json({
        access_token: "must-not-store",
        refresh_token: "must-not-store-refresh",
      });
    };
    await assert.rejects(
      f.runConnectedTool(
        "owner-a",
        "notion_search",
        { account_id: f.state.row.id, query: "example" },
        context,
      ),
      /connection_reauthorization_required/,
    );
    assert.equal(f.state.reads, 1);
    assert.equal(f.state.refreshCalls, 1);
    assert.doesNotMatch(f.state.row.access_token_ciphertext, /must-not-store/);
    assert.doesNotMatch(f.state.row.refresh_token_ciphertext, /must-not-store/);
  }
});

test("forced Notion renewal cannot access another owner, workspace or deleted account", async () => {
  for (const patch of [
    { owner_id: "owner-b" },
    { workspace_id: "workspace-a" },
    { deleted_at: "now" },
  ]) {
    const f = notionFixture();
    Object.assign(f.state.row, patch);
    assert.equal(
      await f.refreshExpiringConnection("owner-a", f.state.row.id, f.state.row.updated_at, true),
      null,
    );
    assert.equal(f.state.decrypts, 0);
    assert.equal(f.state.refreshCalls ?? 0, 0);
  }
});
