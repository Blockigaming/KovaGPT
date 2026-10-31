import test from "node:test";
import assert from "node:assert/strict";
import { discoverGitHubUserRepositories } from "../../src/lib/github-user-access.server.mjs";

const installation = (id = 1, extra = {}) => ({
  id,
  account: { id: 123, login: "team", type: "Organization" },
  repository_selection: "selected",
  permissions: { metadata: "read", contents: "read" },
  events: ["push"],
  suspended_at: null,
  ...extra,
});
const repository = (id = 7, extra = {}) => ({
  id,
  full_name: `team/repo-${id}`,
  visibility: "private",
  default_branch: "main",
  archived: false,
  permissions: { pull: true, push: false, admin: false },
  ...extra,
});
function fixture(overrides = {}) {
  const calls = [];
  const fetchImpl = async (value, init) => {
    const url = new URL(value);
    calls.push({ url, init });
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.authorization, "Bearer fixture-user-access");
    assert.equal(init.headers["x-github-api-version"], "2022-11-28");
    assert.ok(init.signal instanceof AbortSignal);
    const valueOrResponse =
      overrides[url.pathname] ??
      (url.pathname === "/user"
        ? { id: 42 }
        : url.pathname === "/user/installations"
          ? { total_count: 1, installations: [installation()] }
          : url.pathname === "/user/installations/1/repositories"
            ? { total_count: 1, repositories: [repository()] }
            : assert.fail(`Unexpected endpoint ${url.pathname}`));
    const data =
      typeof valueOrResponse === "function" ? valueOrResponse(url, init) : valueOrResponse;
    return data instanceof Response ? data : Response.json(data);
  };
  return {
    calls,
    fetchImpl,
    run: (signal) => discoverGitHubUserRepositories("fixture-user-access", 42, fetchImpl, signal),
  };
}

test("user-authorized repository discovery needs no App JWT, signing key or organization-admin grant", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result[0].installation.id, 1);
  assert.equal(result[0].repositories[0].id, 7);
  assert.deepEqual(
    f.calls.map(({ url }) => url.pathname),
    ["/user", "/user/installations", "/user/installations/1/repositories"],
  );
});
test("the token must belong to the stored GitHub identity before discovering anything", async () => {
  const f = fixture({ "/user": { id: 43 } });
  await assert.rejects(f.run(), /github_account_identity_mismatch/);
  assert.equal(f.calls.length, 1);
});
test("pagination reads every repository and never follows provider-supplied URLs", async () => {
  const f = fixture({
    "/user/installations": {
      total_count: 1,
      installations: [installation(1, { repositories_url: "https://evil.invalid/steal" })],
    },
    "/user/installations/1/repositories": (url) => ({
      total_count: 31,
      repositories:
        url.searchParams.get("page") === "1"
          ? Array.from({ length: 30 }, (_, i) => repository(i + 1))
          : [repository(31)],
    }),
  });
  const result = await f.run();
  assert.equal(result[0].repositories.length, 31);
  assert.deepEqual(
    f.calls
      .slice(2)
      .map(({ url }) => [url.searchParams.get("per_page"), url.searchParams.get("page")]),
    [
      ["30", "1"],
      ["30", "2"],
    ],
  );
});
test("suspended installations have no readable repositories", async () => {
  const f = fixture({
    "/user/installations": {
      total_count: 1,
      installations: [installation(1, { suspended_at: "2026-10-30T00:00:00Z" })],
    },
  });
  assert.deepEqual((await f.run())[0].repositories, []);
  assert.equal(f.calls.length, 2);
});
for (const [status, code] of [
  [401, "github_reconnect_required"],
  [403, "github_access_or_rate_limit_required"],
  [429, "github_discovery_failed"],
  [502, "github_discovery_failed"],
  [302, "github_discovery_failed"],
]) {
  test(`provider HTTP ${status} rejects instead of returning partial access`, async () => {
    const f = fixture({
      "/user/installations/1/repositories": new Response("secret provider detail", { status }),
    });
    await assert.rejects(f.run(), new RegExp(code));
  });
}
test("empty and invalid credentials fail before fetching", async () => {
  let calls = 0;
  const fetchImpl = () => {
    calls++;
    throw new Error("Unexpected fetch");
  };
  for (const [token, user] of [
    ["", 42],
    ["fixture-user-access", 0],
    ["fixture-user-access", 42.5],
    [null, 42],
  ])
    await assert.rejects(
      discoverGitHubUserRepositories(token, user, fetchImpl),
      /github_reconnect_required/,
    );
  assert.equal(calls, 0);
});
for (const [label, path, payload] of [
  ["installation limit", "/user/installations", { total_count: 61, installations: [] }],
  [
    "repository limit",
    "/user/installations/1/repositories",
    { total_count: 1001, repositories: [] },
  ],
  ["missing total", "/user/installations", { installations: [] }],
  ["invalid total", "/user/installations", { total_count: -1, installations: [] }],
  ["partial page", "/user/installations", { total_count: 2, installations: [installation()] }],
  [
    "duplicate installations",
    "/user/installations",
    { total_count: 2, installations: [installation(), installation()] },
  ],
  [
    "invalid installation identity",
    "/user/installations",
    { total_count: 1, installations: [installation(-1)] },
  ],
  [
    "unknown installation type",
    "/user/installations",
    {
      total_count: 1,
      installations: [installation(1, { account: { id: 123, login: "team", type: "Bot" } })],
    },
  ],
  [
    "invalid permissions",
    "/user/installations",
    { total_count: 1, installations: [installation(1, { permissions: [] })] },
  ],
  [
    "invalid suspension",
    "/user/installations",
    { total_count: 1, installations: [installation(1, { suspended_at: "invalid" })] },
  ],
  [
    "oversized page",
    "/user/installations/1/repositories",
    { total_count: 31, repositories: Array.from({ length: 31 }, (_, i) => repository(i + 1)) },
  ],
  [
    "duplicate repositories",
    "/user/installations/1/repositories",
    { total_count: 2, repositories: [repository(), repository()] },
  ],
  [
    "unreadable repository",
    "/user/installations/1/repositories",
    { total_count: 1, repositories: [repository(7, { permissions: { pull: false } })] },
  ],
  [
    "unsafe repository name",
    "/user/installations/1/repositories",
    { total_count: 1, repositories: [repository(7, { full_name: "team/.." })] },
  ],
]) {
  test(`rejects ${label}`, async () => {
    const f = fixture({ [path]: payload });
    await assert.rejects(f.run(), /invalid_github_discovery_response|github_discovery_limit/);
  });
}
test("changing pagination counts fail closed", async () => {
  const f = fixture({
    "/user/installations/1/repositories": (url) => ({
      total_count: url.searchParams.get("page") === "1" ? 31 : 32,
      repositories:
        url.searchParams.get("page") === "1"
          ? Array.from({ length: 30 }, (_, i) => repository(i + 1))
          : [repository(31)],
    }),
  });
  await assert.rejects(f.run(), /invalid_github_discovery_response/);
});
test("a bounded body rejects excessive provider output", async () => {
  const f = fixture({ "/user": new Response("x".repeat(512001)) });
  await assert.rejects(f.run(), /provider_response_too_large/);
});
test("an already-cancelled refresh makes no provider request", async () => {
  const f = fixture();
  const c = new AbortController();
  c.abort();
  await assert.rejects(f.run(c.signal));
  assert.equal(f.calls.length, 0);
});
test("large installation sets cannot exceed the fixed request budget", async () => {
  const entries = Array.from({ length: 50 }, (_, i) => installation(i + 1));
  const calls = [];
  await assert.rejects(
    discoverGitHubUserRepositories("fixture-user-access", 42, async (value) => {
      const u = new URL(value);
      calls.push(u);
      if (u.pathname === "/user") return Response.json({ id: 42 });
      if (u.pathname === "/user/installations")
        return Response.json({
          total_count: 50,
          installations: entries.slice(
            (Number(u.searchParams.get("page")) - 1) * 30,
            Number(u.searchParams.get("page")) * 30,
          ),
        });
      return Response.json({ total_count: 0, repositories: [] });
    }),
    /github_discovery_limit/,
  );
  assert.equal(calls.length, 50);
});
