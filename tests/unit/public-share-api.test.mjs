import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as policy from "../../src/lib/public-chat-share-policy.mjs";
import * as bodyPolicy from "../../src/lib/endpoint-reliability.mjs";
import { isCrossSiteMutation } from "../../src/lib/auth-security.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const queries = [],
    results = [],
    rpc = [];
  const state = {
    auth: true,
    rate: { allowed: true },
    session: true,
    publicResult: { title: "Public snapshot", snapshot: { messages: [] } },
  };
  const db = {
    from(table) {
      const query = { table, calls: [] };
      queries.push(query);
      const chain = new Proxy(
        {},
        {
          get(_target, key) {
            if (key === "then")
              return (resolve, reject) =>
                Promise.resolve(results.shift() ?? { data: null, error: null }).then(
                  resolve,
                  reject,
                );
            return (...args) => {
              query.calls.push([key, ...args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
    rpc(name, args) {
      rpc.push([name, args]);
      return { abortSignal: () => Promise.resolve({ data: state.publicResult, error: null }) };
    },
  };
  const modules = {
    "./api-auth.server": {
      requireVerifiedUser: async () =>
        state.auth
          ? { userId: owner, supabaseAdmin: db, revalidateSession: async () => state.session }
          : new Response(null, { status: 401 }),
    },
    "./auth-security.mjs": { isCrossSiteMutation },
    "./distributed-rate-limit.server": { consumeApplicationRateLimit: async () => state.rate },
    "./endpoint-reliability.mjs": bodyPolicy,
    "./public-chat-share-policy.mjs": policy,
    "@/integrations/supabase/client.server": { supabaseAdmin: db },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync("src/lib/public-chat-share.server.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "require", code)(exports, (name) => {
    assert.ok(name in modules, name);
    return modules[name];
  });
  const request = (
    method = "POST",
    value = {
      title: "Review",
      messages: [{ role: "user", content: "Visible", attachments: [{ content: "Private bytes" }] }],
    },
    headers = {},
  ) =>
    new Request("https://kovagpt.com/api/chat-share", {
      method,
      headers: {
        Origin: "https://kovagpt.com",
        "Content-Type": "application/json",
        "X-Kova-Owner": owner,
        ...headers,
      },
      ...(method !== "GET" ? { body: JSON.stringify(value) } : {}),
    });
  return { ...exports, queries, results, state, rpc, request };
}

test("share management rejects cross-site, unauthenticated, changed-owner, throttled and deleting accounts before writes", async () => {
  for (const kind of ["cross-site", "unauthenticated", "owner", "rate", "deletion"]) {
    const f = fixture();
    const headers = {};
    if (kind === "cross-site") headers.Origin = "https://untrusted.example";
    if (kind === "unauthenticated") f.state.auth = false;
    if (kind === "owner") headers["X-Kova-Owner"] = "another-owner";
    if (kind === "rate") f.state.rate = { allowed: false, status: "unavailable" };
    if (kind === "deletion") f.results.push({ data: { user_id: owner }, error: null });
    const res = await f.handleShareManagement(f.request("POST", undefined, headers));
    assert.ok(res.status >= 400, kind);
    assert.equal(
      f.queries.some((query) => query.table === "chat_public_shares"),
      false,
      kind,
    );
  }
});
test("created links store a digest and reviewed text only, with no private attachment bytes", async () => {
  const f = fixture();
  f.results.push(
    { data: null },
    { data: { id: "share-id", expires_at: "2026-12-01" } },
    { data: null },
  );
  const res = await f.handleShareManagement(f.request());
  assert.equal(res.status, 200);
  const body = await res.json();
  const token = body.path.split("/").at(-1);
  assert.equal(policy.validShareToken(token), true);
  const inserted = f.queries[1].calls.find(([method]) => method === "insert")[1];
  assert.equal(inserted.owner_id, owner);
  assert.equal(inserted.token_hash, await policy.shareTokenHash(token));
  assert.equal(JSON.stringify(inserted).includes("Private bytes"), false);
  assert.equal(JSON.stringify(inserted).includes(token), false);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});
test("a session change after insert withholds the public capability", async () => {
  const f = fixture();
  f.state.session = false;
  f.results.push(
    { data: null },
    { data: { id: "share-id", expires_at: "2026-12-01" } },
    { data: null },
  );
  const res = await f.handleShareManagement(f.request());
  assert.equal(res.status, 409);
  assert.equal((await res.json()).path, undefined);
});
test("revocation filters by both exact link id and verified owner", async () => {
  const f = fixture(),
    id = "22222222-2222-4222-8222-222222222222";
  f.results.push({ data: null }, { data: { id } });
  const res = await f.handleShareManagement(f.request("DELETE", { id }));
  assert.equal(res.status, 200);
  assert.deepEqual(
    f.queries[1].calls.filter(([method]) => method === "eq"),
    [
      ["eq", "id", id],
      ["eq", "owner_id", owner],
    ],
  );
});
test("public reads use a hashed capability, bounded rate checks and private response headers", async () => {
  const f = fixture();
  assert.equal((await f.handlePublicChatShare(f.request("GET"), "not-a-token")).status, 404);
  assert.equal(f.rpc.length, 0);
  const token = "a".repeat(64),
    res = await f.handlePublicChatShare(f.request("GET"), token);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
  assert.match(res.headers.get("X-Robots-Tag"), /noindex/);
  assert.deepEqual(f.rpc, [
    ["read_public_chat_share", { p_token_hash: await policy.shareTokenHash(token) }],
  ]);
});
