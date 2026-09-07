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

function fixture(results) {
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
    "@/lib/github-oauth.server": {
      createInstallationToken: async () => ({ token: "fixture", permissions: {} }),
      decryptSecret: async () => "fixture",
      listGitHubAppInstallations: async () => [{ id: 1, account: { type: "User", id: 42 } }],
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
  });
  return {
    handlers: exports,
    calls,
    pending: queue,
    context: { userId: "owner", supabase: { rpc: async () => ({ error: null }) } },
  };
}

const connected = {
  table: "github_accounts",
  value: { data: [{ id: "account", github_user_id: 42 }], error: null },
};

test("GitHub refresh rejects an installation or repository write failure", async () => {
  for (const failedTable of ["github_installations", "github_repositories"]) {
    const results = [connected];
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
