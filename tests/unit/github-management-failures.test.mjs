import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const source = await readFile(
  new URL("../../src/lib/github.functions.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(results, options = {}) {
  const discoveries = [];
  const calls = [];
  const queue = [...results];
  const admin = {
    from(table) {
      const result = queue.shift();
      assert.ok(result, `Unexpected ${table} query`);
      assert.equal(table, result.table);
      const call = { table, operations: [] };
      calls.push(call);
      const query = new Proxy(
        {},
        {
          get(_target, name) {
            if (name === "then")
              return Promise.resolve(result.value).then.bind(Promise.resolve(result.value));
            return (...args) => {
              call.operations.push([name, ...args]);
              return query;
            };
          },
        },
      );
      return query;
    },
  };
  const exports = {};
  const dependencies = {
    "@tanstack/react-start": {
      createServerFn: () => ({
        middleware() {
          return this;
        },
        validator() {
          return this;
        },
        handler(fn) {
          return fn;
        },
      }),
    },
    zod: { z },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "@/integrations/supabase/client.server": { supabaseAdmin: admin },
    "@/lib/github-oauth.server": { decryptSecret: async () => "fixture" },
    "@/lib/github-user-access.server.mjs": {
      discoverGitHubUserRepositories: async (...args) => {
        discoveries.push(args);
        if (options.discoveryError) throw new Error(options.discoveryError);
        return [
          {
            installation: {
              id: 1,
              account: { type: "User", id: 42, login: "Owner" },
              repository_selection: "selected",
              permissions: {},
              events: [],
              suspended_at: null,
            },
            repositories: [
              {
                id: 7,
                full_name: "Owner/Repo",
                owner: { login: "Owner" },
                visibility: "private",
                default_branch: "main",
                permissions: { pull: true },
                archived: false,
              },
            ],
          },
        ];
      },
    },
    "@/lib/lockdown-policy.mjs": { assertLockdownAllows: async () => {} },
  };
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      assert.ok(name in dependencies, name);
      return dependencies[name];
    },
    process: {
      env: {
        GITHUB_OAUTH_CLIENT_ID: "fixture",
        GITHUB_OAUTH_CLIENT_SECRET: "fixture",
        CONNECTOR_ENCRYPTION_KEY: "fixture",
      },
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({ repositories: [{ id: 7, full_name: "Owner/Repo" }] }),
    }),
    Map,
    Date,
    AbortSignal,
  });
  return {
    handlers: exports,
    calls,
    discoveries,
    pending: queue,
    context: { userId: "owner", supabase: { rpc: async () => ({ error: null }) } },
  };
}

const connected = {
  table: "github_accounts",
  value: {
    data: [
      {
        id: "account",
        github_user_id: 42,
        token_ciphertext: "encrypted-fixture",
        token_expires_at: null,
      },
    ],
    error: null,
  },
};

test("GitHub refresh rejects an installation or repository write failure", async () => {
  for (const failedTable of ["github_installations", "github_repositories"]) {
    const results = [
      connected,
      { table: "github_accounts", value: { data: { id: "account" }, error: null } },
    ];
    results.push({
      table: "github_installations",
      value: { error: failedTable === "github_installations" ? { message: "denied" } : null },
    });
    if (failedTable === "github_repositories")
      results.push({ table: failedTable, value: { error: { message: "denied" } } });
    const f = fixture(results);
    await assert.rejects(
      f.handlers.refreshGitHubInstallations({ context: f.context }),
      /Unable to save GitHub/,
    );
    assert.equal(f.pending.length, 0);
  }
});

test("GitHub management does not convert a failed read into healthy empty data", async () => {
  const f = fixture([
    { table: "github_accounts", value: { data: [], error: null } },
    { table: "github_installations", value: { data: null, error: { message: "offline" } } },
    { table: "github_repositories", value: { data: [], error: null } },
  ]);
  await assert.rejects(
    f.handlers.getGitHubManagement({ context: f.context }),
    /Unable to load GitHub management state/,
  );
});

test("unsupported account data removal fails before any destructive query", async () => {
  const f = fixture([]);
  await assert.rejects(
    f.handlers.disconnectGitHub({
      data: { accountId: "account", removeData: true },
      context: f.context,
    }),
    /Account-scoped GitHub data removal is not available/,
  );
  assert.equal(f.calls.length, 0);
});

test("GitHub access write failures do not report a successful grant", async () => {
  const f = fixture([
    { table: "github_repositories", value: { data: [{ id: 7 }], error: null } },
    { table: "github_repositories", value: { error: { message: "offline" } } },
  ]);
  await assert.rejects(
    f.handlers.updateGitHubRepositoryGrants({
      data: { repositoryIds: [7], granted: true },
      context: f.context,
    }),
    /Unable to update GitHub repository access/,
  );
});

const currentAccount = {
  table: "github_accounts",
  value: { data: { id: "account" }, error: null },
};
const savedInstallation = { table: "github_installations", value: { error: null } };
const savedRepository = { table: "github_repositories", value: { error: null } };

test("successful discovery remains owner bound and does not automatically grant repositories", async () => {
  const f = fixture([
    connected,
    currentAccount,
    savedInstallation,
    savedRepository,
    currentAccount,
  ]);
  const refreshed = await f.handlers.refreshGitHubInstallations({ context: f.context });
  assert.equal(refreshed.count, 1);
  assert.deepEqual(Object.keys(refreshed), ["count"]);
  assert.equal(f.discoveries.length, 1);
  assert.equal(f.discoveries[0][0], "fixture");
  assert.equal(f.discoveries[0][1], 42);
  for (const query of f.calls.filter((call) => call.table === "github_accounts"))
    assert.ok(
      query.operations.some((op) => op[0] === "eq" && op[1] === "owner_id" && op[2] === "owner"),
    );
  for (const table of ["github_installations", "github_repositories"]) {
    const payload = f.calls
      .find((call) => call.table === table)
      .operations.find((op) => op[0] === "upsert")[1];
    assert.equal(payload.owner_id, "owner");
    assert.equal(payload.account_id, "account");
    assert.ok(!Object.hasOwn(payload, "explicitly_granted"));
    assert.ok(!Object.hasOwn(payload, "token_ciphertext"));
  }
  const guard = f.calls[1].operations;
  assert.ok(guard.some((op) => op[0] === "eq" && op[1] === "status" && op[2] === "connected"));
  assert.ok(
    guard.some(
      (op) => op[0] === "eq" && op[1] === "token_ciphertext" && op[2] === "encrypted-fixture",
    ),
  );
});
test("disconnect or credential replacement during discovery prevents repository writes", async () => {
  const f = fixture([connected, { table: "github_accounts", value: { data: null, error: null } }]);
  await assert.rejects(
    f.handlers.refreshGitHubInstallations({ context: f.context }),
    /GitHub account changed/,
  );
  assert.ok(f.calls.every((call) => call.table === "github_accounts"));
  assert.equal(f.pending.length, 0);
});
test("a concurrent account change after persistence does not return refresh success", async () => {
  const f = fixture([
    connected,
    currentAccount,
    savedInstallation,
    savedRepository,
    { table: "github_accounts", value: { data: null, error: null } },
  ]);
  await assert.rejects(
    f.handlers.refreshGitHubInstallations({ context: f.context }),
    /GitHub account changed/,
  );
  assert.equal(f.pending.length, 0);
});
test("an incomplete provider discovery does not persist partial grants", async () => {
  const f = fixture([connected], { discoveryError: "github_discovery_failed" });
  await assert.rejects(
    f.handlers.refreshGitHubInstallations({ context: f.context }),
    /github_discovery_failed/,
  );
  assert.equal(f.calls.length, 1);
});
test("expired credentials require reconnect before provider requests or writes", async () => {
  const row = {
    ...connected,
    value: {
      data: [{ ...connected.value.data[0], token_expires_at: "2020-01-01T00:00:00Z" }],
      error: null,
    },
  };
  const f = fixture([row]);
  await assert.rejects(
    f.handlers.refreshGitHubInstallations({ context: f.context }),
    /GitHub reconnect required/,
  );
  assert.equal(f.discoveries.length, 0);
  assert.equal(f.calls.length, 1);
});
test("account discovery cannot silently truncate the owner's connected accounts", async () => {
  const f = fixture([
    {
      ...connected,
      value: { data: Array.from({ length: 21 }, () => connected.value.data[0]), error: null },
    },
  ]);
  await assert.rejects(
    f.handlers.refreshGitHubInstallations({ context: f.context }),
    /account limit/,
  );
  assert.equal(f.discoveries.length, 0);
});
