import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { GitHubClient } from "../../src/lib/github-connector.mjs";
import * as bounded from "../../src/lib/bounded-json.server.mjs";

function compile(source, dependencies) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
      crypto,
      Response,
      Request,
      URL,
      Date,
      Object,
      Number,
      String,
      Set,
      console,
    },
  );
  return exports;
}
const policy = compile(await readFile("src/lib/github-tool-policy.ts", "utf8"), { zod: { z } });
const source = await readFile("src/routes/api/github/tool.ts", "utf8");
const accountId = "10000000-0000-4000-8000-000000000001";
function fixture() {
  const f = {
    owner: "alice",
    calls: [],
    queries: [],
    deny: false,
    session: true,
    fail: null,
    providerFails: false,
  };
  f.rows = {
    user_preferences: [
      {
        user_id: "alice",
        settings: {
          github_access_mode: "write",
          github_access_revision: "v1",
          lockdown_mode: false,
          unrelated: "keep",
        },
      },
    ],
    github_repositories: [
      {
        id: 7,
        owner_id: "alice",
        full_name: "acme/repo",
        account_id: accountId,
        permissions: { push: true },
        explicitly_granted: true,
        revoked_at: null,
        default_branch: "main",
        updated_at: "v1",
        installation_id: null,
        archived: false,
      },
    ],
    github_accounts: [
      {
        id: accountId,
        owner_id: "alice",
        login: "alice-gh",
        token_ciphertext: "encrypted",
        status: "connected",
        updated_at: "v1",
      },
    ],
    github_installations: [],
    pending_tool_actions: [],
    github_tool_audit: [],
  };
  const db = {
    from(table) {
      assert.ok(table in f.rows, table);
      const query = { table, filters: [], operation: "select", payload: null, limit: Infinity };
      f.queries.push(query);
      let single = false;
      const q = {
        select() {
          return q;
        },
        eq(key, value) {
          query.filters.push((row) =>
            key === "settings" ? JSON.stringify(row[key]) === value : row[key] === value,
          );
          return q;
        },
        is(key, value) {
          return q.eq(key, value);
        },
        gt(key, value) {
          query.filters.push((row) => row[key] > value);
          return q;
        },
        like(key, value) {
          query.filters.push((row) => row[key]?.startsWith(value.slice(0, -1)));
          return q;
        },
        order() {
          return q;
        },
        limit(n) {
          query.limit = n;
          return q;
        },
        update(value) {
          query.operation = "update";
          query.payload = structuredClone(value);
          return q;
        },
        insert(value) {
          query.operation = "insert";
          query.payload = structuredClone(value);
          return q;
        },
        single() {
          single = true;
          return q;
        },
        maybeSingle() {
          single = true;
          return q;
        },
        then(resolve, reject) {
          return Promise.resolve()
            .then(() => {
              if (f.fail?.(query)) return { data: null, error: { message: "database offline" } };
              let rows = f.rows[table]
                .filter((row) => query.filters.every((match) => match(row)))
                .slice(0, query.limit);
              if (query.operation === "insert") {
                const row = {
                  id: `20000000-0000-4000-8000-${String(f.rows[table].length + 1).padStart(12, "0")}`,
                  status: "pending",
                  expires_at: new Date(Date.now() + 900000).toISOString(),
                  ...query.payload,
                };
                f.rows[table].push(row);
                rows = [row];
              } else if (query.operation === "update")
                rows.forEach((row) => Object.assign(row, query.payload));
              return { data: structuredClone(single ? (rows[0] ?? null) : rows), error: null };
            })
            .then(resolve, reject);
        },
      };
      return q;
    },
  };
  class Client extends GitHubClient {
    constructor(options) {
      super({
        ...options,
        fetchImpl: async (url, init) => {
          f.calls.push({ url, init });
          if (f.providerFails) throw new Error("lost response");
          return new Response(JSON.stringify({ id: 99, sha: "a".repeat(40), items: [] }), {
            headers: { "content-type": "application/json" },
          });
        },
      });
    }
  }
  const { Route } = compile(source, {
    "@tanstack/react-router": { createFileRoute: () => (value) => value },
    "@/lib/api-auth.server": {
      requireUser: async () => ({
        userId: f.owner,
        supabaseAdmin: db,
        revalidateSession: async () => f.session,
      }),
    },
    "@/lib/github-oauth.server": { decryptSecret: async () => "private-fixture-token" },
    "@/lib/github-connector.mjs": { GitHubClient: Client },
    "@/lib/lockdown-policy.mjs": {
      enforceLockdownCapability: async () =>
        f.deny ? Response.json({ error: "lockdown" }, { status: 423 }) : null,
    },
    "@/lib/bounded-json.server.mjs": bounded,
    "@/lib/github-tool-policy": policy,
    zod: { z },
  });
  f.post = async (body) =>
    Route.server.handlers.POST({
      request: new Request("https://kova.test/api/github/tool", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    });
  f.get = async (id = "") =>
    Route.server.handlers.GET({
      request: new Request(`https://kova.test/api/github/tool${id ? `?action_id=${id}` : ""}`),
    });
  f.stage = async () => {
    const response = await f.post({
      tool: "createIssue",
      repository: "Acme/Repo",
      args: { title: "Exact title", body: "Full original body" },
    });
    assert.equal(response.status, 202);
    return (await response.json()).action.actionId;
  };
  return f;
}

test("GitHub preparation persists exact owner/account/repository/arguments without contacting the provider", async () => {
  const f = fixture(),
    id = await f.stage();
  assert.equal(f.calls.length, 0);
  const action = f.rows.pending_tool_actions[0];
  assert.equal(action.user_id, "alice");
  assert.equal(action.args.accountId, accountId);
  assert.equal(action.args.repository, "acme/repo");
  assert.equal(action.args.args.body, "Full original body");
  const listed = await (await f.get()).json();
  assert.equal(listed.actions[0].actionId, id);
  assert.equal(listed.actions[0].argsPreview.details.title, "Exact title");
  assert.ok(!JSON.stringify(listed).includes("encrypted"));
});

test("client confirmation flags and substituted arguments cannot authorize a write", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.post({
        tool: "createIssue",
        repository: "acme/repo",
        args: { title: "x" },
        confirmed: true,
      })
    ).status,
    409,
  );
  const id = await f.stage();
  assert.equal(
    (await f.post({ action_id: id, decision: "confirm", args: { title: "substitution" } })).status,
    400,
  );
  assert.equal(f.calls.length, 0);
});

test("concurrent confirmation consumes an approval once and replay returns the saved outcome", async () => {
  const f = fixture(),
    id = await f.stage();
  await Promise.all([
    f.post({ action_id: id, decision: "confirm" }),
    f.post({ action_id: id, decision: "confirm" }),
  ]);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), {
    title: "Exact title",
    body: "Full original body",
  });
  assert.equal(f.rows.pending_tool_actions[0].status, "confirmed");
  assert.equal((await f.post({ action_id: id, decision: "confirm" })).status, 200);
  assert.equal(f.calls.length, 1);
});

test("cancellation is owner scoped and cannot be confirmed later", async () => {
  const f = fixture(),
    id = await f.stage();
  f.owner = "mallory";
  assert.equal((await f.get(id)).status, 404);
  assert.equal((await f.post({ action_id: id, decision: "confirm" })).status, 404);
  f.owner = "alice";
  assert.equal((await f.post({ action_id: id, decision: "cancel" })).status, 200);
  assert.equal((await f.post({ action_id: id, decision: "confirm" })).status, 409);
  assert.equal(f.calls.length, 0);
});

for (const [label, mutate, status] of [
  [
    "expired",
    (f) => {
      f.rows.pending_tool_actions[0].expires_at = "2000-01-01T00:00:00Z";
    },
    409,
  ],
  [
    "revoked",
    (f) => {
      f.rows.github_repositories[0].revoked_at = "now";
    },
    403,
  ],
  [
    "read-only",
    (f) => {
      f.rows.github_repositories[0].permissions = { push: false };
    },
    403,
  ],
  [
    "archived",
    (f) => {
      f.rows.github_repositories[0].archived = true;
    },
    403,
  ],
  [
    "disconnected",
    (f) => {
      f.rows.github_accounts[0].status = "disconnected";
    },
    401,
  ],
  [
    "reconnected",
    (f) => {
      f.rows.github_accounts[0].updated_at = "v2";
    },
    409,
  ],
  [
    "grant changed",
    (f) => {
      f.rows.github_repositories[0].updated_at = "v2";
    },
    409,
  ],
  [
    "session revoked",
    (f) => {
      f.session = false;
    },
    401,
  ],
  [
    "lockdown",
    (f) => {
      f.deny = true;
    },
    423,
  ],
  [
    "suspended installation",
    (f) => {
      f.rows.github_repositories[0].installation_id = 3;
      f.rows.github_installations.push({
        id: 3,
        owner_id: "alice",
        account_id: accountId,
        suspended_at: "now",
      });
    },
    403,
  ],
])
  test(`GitHub ${label} blocks confirmation before provider dispatch`, async () => {
    const f = fixture(),
      id = await f.stage();
    mutate(f);
    assert.equal((await f.post({ action_id: id, decision: "confirm" })).status, status);
    assert.equal(f.calls.length, 0);
  });

test("uncertain provider result remains consumed and cannot be automatically retried", async () => {
  const f = fixture(),
    id = await f.stage();
  f.providerFails = true;
  assert.equal((await f.post({ action_id: id, decision: "confirm" })).status, 502);
  assert.equal((await (await f.get(id)).json()).status, "processing");
  assert.equal((await f.post({ action_id: id, decision: "confirm" })).status, 409);
  assert.equal(f.calls.length, 1);
});

test("failed completion persistence does not authorize a second provider mutation", async () => {
  const f = fixture(),
    id = await f.stage();
  f.fail = (q) => q.payload?.status === "confirmed";
  const response = await f.post({ action_id: id, decision: "confirm" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error_code, "completion_persistence_ambiguous");
  assert.equal((await f.post({ action_id: id, decision: "confirm" })).status, 409);
  assert.equal(f.calls.length, 1);
});

test("failed approval claim and persistence fail before any provider mutation", async () => {
  for (const point of ["insert", "claim"]) {
    const f = fixture();
    if (point === "insert") {
      f.fail = (q) => q.table === "pending_tool_actions" && q.operation === "insert";
      assert.equal(
        (await f.post({ tool: "createIssue", repository: "acme/repo", args: { title: "x" } }))
          .status,
        503,
      );
    } else {
      const id = await f.stage();
      f.fail = (q) => q.payload?.status === "processing";
      assert.equal((await f.post({ action_id: id, decision: "confirm" })).status, 409);
    }
    assert.equal(f.calls.length, 0);
  }
});

test("reads remain repository-scoped and reject malformed or scope-expanding requests", async () => {
  const f = fixture();
  assert.equal((await f.post(null)).status, 400);
  assert.equal(
    (await f.post({ tool: "file", repository: "acme/other", args: { path: "README.md" } })).status,
    403,
  );
  for (const query of ["needle repo:acme/private", "needle OR secret", "org:someone"]) {
    assert.equal(
      (await f.post({ tool: "searchCode", repository: "acme/repo", args: { query } })).status,
      400,
    );
  }
  assert.equal(
    (await f.post({ tool: "file", repository: "acme/repo", args: { path: "../secret" } })).status,
    400,
  );
  assert.equal(
    (
      await f.post({
        tool: "createIssue",
        repository: "acme/repo",
        args: { title: "x".repeat(70000) },
      })
    ).status,
    413,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(
    (await f.post({ tool: "file", repository: "acme/repo", args: { path: "README.md" } })).status,
    200,
  );
  assert.equal(f.calls.length, 1);
});

test("merge requests require an exact reviewed head SHA", () => {
  assert.throws(() =>
    policy.parseGitHubTool({
      tool: "mergePull",
      repository: "acme/repo",
      args: { number: 1, input: { merge_method: "squash" } },
    }),
  );
});

test("GitHub access defaults to view, respects disabled, and requires view+write for mutations", async () => {
  const f = fixture();
  f.rows.user_preferences[0].settings = {};
  assert.equal(
    (await f.post({ tool: "file", repository: "acme/repo", args: { path: "README.md" } })).status,
    200,
  );
  assert.equal(
    (await f.post({ tool: "createIssue", repository: "acme/repo", args: { title: "x" } })).status,
    403,
  );
  assert.equal((await f.post({ access_mode: "none" })).status, 200);
  assert.equal(
    (await f.post({ tool: "file", repository: "acme/repo", args: { path: "README.md" } })).status,
    403,
  );
  assert.equal(f.calls.length, 1);
});

test("access changes preserve other settings and invalidate old approvals even after re-enable", async () => {
  const f = fixture(),
    id = await f.stage();
  assert.equal((await f.post({ access_mode: "view" })).status, 200);
  assert.equal(f.rows.user_preferences[0].settings.unrelated, "keep");
  assert.equal(f.rows.user_preferences[0].settings.lockdown_mode, false);
  assert.equal((await f.post({ access_mode: "write" })).status, 200);
  assert.equal((await f.post({ action_id: id, decision: "confirm" })).status, 409);
  assert.equal(f.calls.length, 0);
});

test("missing or invalid access state fails closed and mode changes stay owner scoped", async () => {
  const f = fixture();
  f.fail = (q) => q.table === "user_preferences";
  assert.equal(
    (await f.post({ tool: "file", repository: "acme/repo", args: { path: "README.md" } })).status,
    503,
  );
  f.fail = null;
  f.rows.user_preferences[0].settings = [];
  assert.equal((await f.get()).status, 503);
  f.owner = "bob";
  assert.equal((await f.post({ access_mode: "none" })).status, 200);
  assert.equal(f.rows.user_preferences[0].user_id, "alice");
  assert.ok(Array.isArray(f.rows.user_preferences[0].settings));
  assert.equal(f.rows.user_preferences[1].user_id, "bob");
});

test("a concurrent preferences change is preserved instead of overwritten by an access update", async () => {
  const f = fixture();
  f.fail = (q) => {
    if (q.table === "user_preferences" && q.operation === "update")
      f.rows.user_preferences[0].settings.lockdown_mode = true;
    return false;
  };
  assert.equal((await f.post({ access_mode: "none" })).status, 409);
  assert.equal(f.rows.user_preferences[0].settings.lockdown_mode, true);
  assert.equal(f.rows.user_preferences[0].settings.github_access_mode, "write");
});

test("disabling GitHub while the approval is claimed still prevents provider dispatch", async () => {
  const f = fixture(),
    id = await f.stage();
  f.fail = (q) => {
    if (q.payload?.status === "processing")
      f.rows.user_preferences[0].settings.github_access_mode = "none";
    return false;
  };
  assert.equal((await f.post({ action_id: id, decision: "confirm" })).status, 409);
  assert.equal(f.calls.length, 0);
});
