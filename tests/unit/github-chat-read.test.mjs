import assert from "node:assert/strict";
import test from "node:test";
import {
  createGitHubChatTools,
  githubChatRequest,
  readGitHubChat,
} from "../../src/lib/github-chat-read.server.mjs";

const file = (content = "Example source", path = "README.md") => ({
  type: "file",
  path,
  size: Buffer.byteLength(content),
  encoding: "base64",
  content: Buffer.from(content).toString("base64"),
});
function fixture() {
  const owner = "owner-a",
    stamp = "2026-10-30T00:00:00Z";
  const state = {
    configured: true,
    lockdown: false,
    limited: false,
    decrypts: 0,
    calls: [],
    fetched: [],
    audit: [],
    tables: {
      github_accounts: [
        {
          id: "account-a",
          owner_id: owner,
          auth_type: "oauth",
          status: "connected",
          token_ciphertext: "encrypted-fixture",
          token_expires_at: null,
          updated_at: stamp,
        },
      ],
      github_repositories: [
        {
          id: 7,
          owner_id: owner,
          account_id: "account-a",
          installation_id: 8,
          full_name: "Owner/Repo",
          permissions: { pull: true },
          explicitly_granted: true,
          revoked_at: null,
          updated_at: stamp,
        },
      ],
      github_installations: [
        { id: 8, owner_id: owner, account_id: "account-a", suspended_at: null, updated_at: stamp },
      ],
    },
  };
  const db = {
    from(table) {
      const filters = [];
      let max = Infinity;
      state.calls.push(table);
      const value = () =>
        state.dbError
          ? { data: null, error: {} }
          : {
              data: structuredClone(
                state.tables[table]
                  .filter((r) => filters.every(([k, v]) => r[k] === v))
                  .slice(0, max),
              ),
              error: null,
            };
      const chain = {
        select: () => chain,
        eq: (k, v) => {
          filters.push([k, v]);
          return chain;
        },
        is: (k, v) => {
          filters.push([k, v]);
          return chain;
        },
        limit: (n) => {
          max = n;
          return chain;
        },
        maybeSingle: async () => {
          const result = value();
          return { ...result, data: result.data?.[0] ?? null };
        },
        then: (resolve, reject) => Promise.resolve(value()).then(resolve, reject),
        insert: async (row) => {
          state.audit.push(row);
          return { error: null };
        },
      };
      return chain;
    },
  };
  const tools = createGitHubChatTools({
    db,
    guard: async (id) => {
      state.guardedOwner = id;
      if (state.lockdown) throw new Error("lockdown_mode");
    },
    configured: () => state.configured,
    rate: async () => !state.limited,
    decrypt: async () => {
      state.decrypts++;
      return "fixture-token";
    },
    fetchImpl: async (url, init) => {
      state.fetched.push({ url, init });
      await state.onFetch?.();
      return state.response ?? Response.json(file());
    },
  });
  return {
    state,
    ...tools,
    owner,
    account: state.tables.github_accounts[0],
    repository: state.tables.github_repositories[0],
    installation: state.tables.github_installations[0],
  };
}
const args = { repository: "owner/repo", operation: "readme" };

test("chat offers only explicitly granted owner repositories and omits all credentials", async () => {
  const f = fixture(),
    context = await f.getContext(f.owner);
  assert.equal(context.tools.length, 1);
  assert.equal(context.tools[0].function.name, "github_read");
  assert.deepEqual(context.tools[0].function.parameters.properties.repository.enum, ["owner/repo"]);
  assert.doesNotMatch(JSON.stringify(context), /encrypted-fixture|fixture-token/);
  const result = await f.run(f.owner, "github_read", args, context);
  assert.equal(result.content, "Example source");
  assert.equal(f.state.fetched[0].init.method, "GET");
  assert.equal(f.state.fetched[0].init.redirect, "error");
  assert.ok(f.state.fetched[0].init.signal instanceof AbortSignal);
  assert.equal(f.state.audit[0].success, true);
  assert.doesNotMatch(JSON.stringify(f.state.audit), /fixture-token|Example source|encrypted/);
});

for (const [label, mutate] of [
  [
    "another owner",
    (f) => {
      f.repository.owner_id = "owner-b";
    },
  ],
  [
    "ungranted repository",
    (f) => {
      f.repository.explicitly_granted = false;
    },
  ],
  [
    "revoked repository",
    (f) => {
      f.repository.revoked_at = "2026-10-30";
    },
  ],
  [
    "missing read permission",
    (f) => {
      f.repository.permissions.pull = false;
    },
  ],
  [
    "different account",
    (f) => {
      f.repository.account_id = "account-b";
    },
  ],
  [
    "disconnected account",
    (f) => {
      f.account.status = "disconnected";
    },
  ],
  [
    "app authentication",
    (f) => {
      f.account.auth_type = "app";
    },
  ],
  [
    "missing credential",
    (f) => {
      f.account.token_ciphertext = null;
    },
  ],
  [
    "expired credential",
    (f) => {
      f.account.token_expires_at = new Date(0).toISOString();
    },
  ],
  [
    "invalid expiry",
    (f) => {
      f.account.token_expires_at = "invalid";
    },
  ],
  [
    "suspended installation",
    (f) => {
      f.installation.suspended_at = "2026-10-30";
    },
  ],
  [
    "installation account mismatch",
    (f) => {
      f.installation.account_id = "account-b";
    },
  ],
])
  test(`planning excludes ${label}`, async () => {
    const f = fixture();
    mutate(f);
    assert.deepEqual((await f.getContext(f.owner)).tools, []);
    assert.equal(f.state.decrypts, 0);
    assert.equal(f.state.fetched.length, 0);
  });

for (const [label, mutate] of [
  [
    "grant revoked",
    (f) => {
      f.repository.explicitly_granted = false;
    },
  ],
  [
    "account disconnected",
    (f) => {
      f.account.status = "disconnected";
    },
  ],
  [
    "credentials rotated",
    (f) => {
      f.account.updated_at = "changed";
    },
  ],
  [
    "repository regranted",
    (f) => {
      f.repository.updated_at = "changed";
    },
  ],
  [
    "installation suspended",
    (f) => {
      f.installation.suspended_at = "2026-10-30";
    },
  ],
])
  test(`execution rejects ${label} after planning without decrypting or fetching`, async () => {
    const f = fixture(),
      context = await f.getContext(f.owner);
    mutate(f);
    await assert.rejects(f.run(f.owner, "github_read", args, context), /binding_changed/);
    assert.equal(f.state.decrypts, 0);
    assert.equal(f.state.fetched.length, 0);
  });

for (const [label, mutate] of [
  [
    "grant revoked",
    (f) => {
      f.repository.explicitly_granted = false;
    },
  ],
  [
    "token changed without version",
    (f) => {
      f.account.token_ciphertext = "different";
    },
  ],
  [
    "account disconnected",
    (f) => {
      f.account.status = "disconnected";
    },
  ],
  [
    "Lockdown enabled",
    (f) => {
      f.state.lockdown = true;
    },
  ],
])
  test(`in-flight ${label} prevents returning provider data`, async () => {
    const f = fixture(),
      context = await f.getContext(f.owner);
    f.state.onFetch = () => mutate(f);
    await assert.rejects(f.run(f.owner, "github_read", args, context));
    assert.equal(f.state.fetched.length, 1);
    assert.equal(f.state.audit[0].success, false);
  });

test("Lockdown, rate protection, owner mismatch and arbitrary tools fail before provider access", async () => {
  for (const condition of ["lockdown", "limited", "owner", "tool", "repository", "extra"]) {
    const f = fixture(),
      context = await f.getContext(f.owner);
    if (["lockdown", "limited"].includes(condition)) f.state[condition] = true;
    await assert.rejects(
      f.run(
        condition === "owner" ? "owner-b" : f.owner,
        condition === "tool" ? "createIssue" : "github_read",
        {
          ...args,
          ...(condition === "repository" ? { repository: "other/repo" } : {}),
          ...(condition === "extra" ? { url: "https://evil.example" } : {}),
        },
        context,
      ),
    );
    assert.equal(f.state.decrypts, 0);
    assert.equal(f.state.fetched.length, 0);
  }
});

test("unconfigured deployment, database failure and discovery limits never invent usable tools", async () => {
  const f = fixture();
  f.state.configured = false;
  assert.deepEqual((await f.getContext(f.owner)).tools, []);
  assert.equal(f.state.calls.length, 0);
  f.state.configured = true;
  f.state.dbError = true;
  await assert.rejects(f.getContext(f.owner), /context_unavailable/);
  f.state.dbError = false;
  f.state.tables.github_repositories = Array.from({ length: 101 }, (_, i) => ({
    ...f.repository,
    id: i + 1,
  }));
  await assert.rejects(f.getContext(f.owner), /context_unavailable/);
});

test("request builder fixes origin, methods, limits and safely encodes file and ref arguments", () => {
  for (const operation of ["readme", "issues", "pulls", "file"]) {
    const url = new URL(
      githubChatRequest("owner/repo", {
        operation,
        ...(operation === "file" ? { path: "src/a?b#c.ts", ref: "feature/a?b" } : {}),
      }),
    );
    assert.equal(url.origin, "https://api.github.com");
    if (operation === "file") {
      assert.match(url.pathname, /a%3Fb%23c.ts$/);
      assert.equal(url.searchParams.get("ref"), "feature/a?b");
    }
    if (["issues", "pulls"].includes(operation))
      assert.equal(url.searchParams.get("per_page"), "10");
  }
  for (const path of ["", "../secret", "./x", "/absolute", "src//file", "x\u0000", "x".repeat(501)])
    assert.throws(
      () => githubChatRequest("owner/repo", { operation: "file", path }),
      /arguments_invalid/,
    );
  for (const repo of [
    "../repo",
    "owner/..",
    "owner/repo?x=1",
    "https://evil.example",
    "owner/repo/path",
  ])
    assert.throws(() => githubChatRequest(repo, args), /arguments_invalid/);
  for (const operation of ["createIssue", "mergePull", "request", "constructor", "__proto__"])
    assert.throws(() => githubChatRequest("owner/repo", { operation }), /arguments_invalid/);
});

test("issue and pull results are capped and provider links or extra fields cannot escape", async () => {
  const response = [
    {
      number: 4,
      title: "x".repeat(400),
      body: "b".repeat(2000),
      html_url: "javascript:alert(1)",
      secret: "discard",
    },
    { number: 5, title: "PR", pull_request: {} },
  ];
  const result = await readGitHubChat("owner/repo", { operation: "issues" }, "fixture", async () =>
    Response.json(response),
  );
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].title.length, 300);
  assert.equal(result.results[0].snippet.length, 1000);
  assert.equal(result.results[0].url, "https://github.com/owner/repo/issues/4");
  assert.doesNotMatch(JSON.stringify(result), /discard|javascript/);
  assert.equal(result.untrusted_source_data, true);
});

test("malformed, oversized, binary, directory and mismatched file responses fail safely", async () => {
  for (const response of [
    [],
    { ...file(), type: "dir" },
    { ...file(), encoding: "none" },
    { ...file(), size: 96_001 },
    { ...file(), content: "invalid!" },
    { ...file(), size: 1 },
    { ...file(), content: Buffer.from([0xff]).toString("base64"), size: 1 },
    { ...file(), path: "other.md" },
  ])
    await assert.rejects(
      readGitHubChat("owner/repo", { operation: "file", path: "README.md" }, "fixture", async () =>
        Response.json(response),
      ),
    );
  await assert.rejects(
    readGitHubChat(
      "owner/repo",
      { operation: "readme" },
      "fixture",
      async () => new Response("x".repeat(192_001)),
    ),
    /response_invalid/,
  );
  const content = "x".repeat(30_000);
  const result = await readGitHubChat("owner/repo", { operation: "readme" }, "fixture", async () =>
    Response.json(file(content)),
  );
  assert.equal(result.content.length, 18_000);
  assert.equal(result.truncated, true);
});

test("escaped source text remains complete JSON within the chat result budget", async () => {
  const source = '\u0000\n\t\\"'.repeat(3000);
  const result = await readGitHubChat("owner/repo", { operation: "readme" }, "fixture", async () =>
    Response.json(file(source)),
  );
  assert.equal(result.truncated, true);
  assert.ok(JSON.stringify(result).length < 24000);
  assert.deepEqual(JSON.parse(JSON.stringify(result).slice(0, 24000)), result);
  const issues = Array.from({ length: 10 }, (_, i) => ({
    number: i + 1,
    title: source.slice(0, 400),
    body: source.slice(0, 1500),
  }));
  const rows = await readGitHubChat("owner/repo", { operation: "issues" }, "fixture", async () =>
    Response.json(issues),
  );
  assert.ok(JSON.stringify(rows).length < 24000);
});

for (const status of [401, 403, 404, 429, 500])
  test(`provider ${status} yields only a fixed safe error`, async () => {
    await assert.rejects(
      readGitHubChat(
        "owner/repo",
        { operation: "readme" },
        "fixture",
        async () => new Response("private provider details fixture-secret", { status }),
      ),
      (error) => !/private|fixture-secret/.test(error.message),
    );
  });
