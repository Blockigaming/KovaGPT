import test from "node:test";
import assert from "node:assert/strict";
import { GitHubClient, verifyGitHubWebhook } from "../../src/lib/github-connector.mjs";
function response(data, status = 200, headers = {}) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4999",
      ...headers,
    },
  });
}
test("repository allowlist blocks every ungranted repository", async () => {
  const client = new GitHubClient({
    token: "test",
    allowedRepositories: ["acme/allowed"],
    fetchImpl: async () => response({}),
  });
  await assert.rejects(
    () => client.file("acme/private", "README.md"),
    (error) => error.code === "repository_not_authorized",
  );
  await client.file("acme/allowed", "README.md");
});
test("read tools use typed GitHub endpoints and pagination", async () => {
  const calls = [];
  const client = new GitHubClient({
    token: "test",
    allowedRepositories: ["acme/repo"],
    fetchImpl: async (url, init) => {
      calls.push([url, init]);
      return response([]);
    },
  });
  await client.searchCode("acme/repo", "needle");
  await client.tree("acme/repo", "main");
  await client.branches("acme/repo");
  await client.commits("acme/repo");
  await client.pulls("acme/repo");
  await client.issues("acme/repo");
  await client.releases("acme/repo");
  await client.workflows("acme/repo");
  await client.workflowRuns("acme/repo");
  assert.ok(calls.some(([url]) => url.includes("/search/code")));
  assert.ok(calls.every(([, init]) => init.headers.authorization === "Bearer test"));
});
test("all writes require explicit confirmation", async () => {
  const client = new GitHubClient({
    token: "test",
    allowedRepositories: ["acme/repo"],
    fetchImpl: async () => response({ id: 1 }),
  });
  await assert.rejects(
    () => client.createIssue("acme/repo", { title: "Issue" }, false),
    (error) => error.code === "confirmation_required",
  );
  assert.equal((await client.createIssue("acme/repo", { title: "Issue" }, true)).id, 1);
  await assert.rejects(() => client.mergePull("acme/repo", 1, {}, false), /confirmation/i);
});
test("rate limits and authorization loss map to operational errors", async () => {
  const limited = new GitHubClient({
    token: "test",
    allowedRepositories: ["acme/repo"],
    fetchImpl: async () => response({}, 403, { "x-ratelimit-remaining": "0", "retry-after": "30" }),
  });
  await assert.rejects(
    () => limited.file("acme/repo", "x"),
    (error) => error.code === "rate_limited" && error.retryAfter === 30,
  );
  const revoked = new GitHubClient({
    token: "test",
    allowedRepositories: ["acme/repo"],
    fetchImpl: async () => response({}, 401),
  });
  await assert.rejects(
    () => revoked.file("acme/repo", "x"),
    (error) => error.code === "authorization_lost",
  );
});
test("webhook HMAC validation rejects tampering", async () => {
  const secret = "hook-secret",
    body = '{"action":"opened"}';
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const signature = `sha256=${Buffer.from(bytes).toString("hex")}`;
  assert.equal(await verifyGitHubWebhook({ secret, signature, body }), true);
  assert.equal(await verifyGitHubWebhook({ secret, signature, body: `${body}x` }), false);
});
