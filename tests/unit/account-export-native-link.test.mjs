import assert from "node:assert/strict";
import test from "node:test";
import * as privateFiles from "../../src/lib/kova-auth-private-download.mjs";
import * as policy from "../../src/lib/account-export-policy.mjs";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const artifact = "33333333-3333-4333-8333-333333333333";
function fixture() {
  const queries = [];
  const state = {
    account: owner,
    authorized: true,
    row: {
      id,
      user_id: owner,
      status: "complete",
      requested_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      size_bytes: 4096,
      failure_code: null,
      storage_path: `${owner}/${id}/${artifact}.json`,
      content_sha256: "a".repeat(64),
    },
  };
  const auth = async () =>
    state.authorized
      ? {
          userId: state.account,
          authProvider: "kova",
          supabaseAdmin: {
            from(table) {
              const query = { table, columns: "", owner: null };
              queries.push(query);
              return {
                select(columns) {
                  query.columns = columns;
                  return this;
                },
                eq(name, value) {
                  if (name === "user_id") query.owner = value;
                  return this;
                },
                order() {
                  return this;
                },
                limit() {
                  return this;
                },
                async maybeSingle() {
                  return {
                    error: null,
                    data:
                      query.owner === state.row.user_id
                        ? Object.fromEntries(
                            query.columns.split(",").map((name) => [name, state.row[name]]),
                          )
                        : null,
                  };
                },
              };
            },
            storage: {
              from() {
                assert.fail("Native links must not issue bearer Storage URLs");
              },
            },
          },
        }
      : Response.json({ error: "Unauthorized" }, { status: 401 });
  const { Route } = loadUiModule(
    "src/routes/api/account/export.ts",
    {
      "@tanstack/react-router": { createFileRoute: () => (route) => route },
      "@/lib/kova-auth-private-download.mjs": privateFiles,
      "@/lib/api-auth.server": { requireUser: auth, requireVerifiedUser: auth },
      "@/lib/auth-security.mjs": {},
      "@/lib/bounded-json.server.mjs": {},
      "@/lib/distributed-rate-limit.server": {},
      "@/lib/account-export-policy.mjs": policy,
      "@/lib/account-export.server": {},
    },
    { Response, URL },
  );
  return {
    state,
    queries,
    run: () =>
      Route.server.handlers.GET({
        request: new Request("https://kova.test/api/account/export?download=1"),
      }),
  };
}
test("native completed exports project their hash and return an authorized owner/version-bound link without exposing it", async () => {
  const f = fixture();
  const response = await f.run();
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.requiresSession, true);
  assert.equal(value.downloadExpiresInSeconds, 0);
  const url = new URL(value.downloadUrl, "https://kova.test");
  assert.equal(url.pathname, "/api/private-files");
  assert.equal(url.searchParams.get("kind"), "export");
  assert.equal(url.searchParams.get("owner"), owner);
  assert.equal(url.searchParams.get("id"), id);
  assert.match(url.searchParams.get("version"), /^[a-f0-9]{64}$/);
  assert.ok(f.queries[0].columns.split(",").includes("content_sha256"));
  assert.equal(value.job.content_sha256, undefined);
  assert.equal(value.job.storage_path, undefined);
  assert.doesNotMatch(JSON.stringify(value), /token=|Bearer|account-exports\//);
});
test("native export links still require ownership, an unexpired completed job, and its recorded digest", async () => {
  const f = fixture();
  f.state.account = artifact;
  assert.equal((await (await f.run()).json()).job, null);
  f.state.account = owner;
  f.state.row.expires_at = new Date(Date.now() - 1).toISOString();
  assert.equal((await f.run()).status, 409);
  f.state.row.expires_at = new Date(Date.now() + 3600000).toISOString();
  f.state.row.content_sha256 = null;
  assert.equal((await f.run()).status, 503);
  f.state.row.content_sha256 = "a".repeat(64);
  f.state.row.storage_path = `${artifact}/${id}/${artifact}.json`;
  assert.equal((await f.run()).status, 503);
  f.state.authorized = false;
  assert.equal((await f.run()).status, 401);
});
