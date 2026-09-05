import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readFile } from "node:fs/promises";
import * as policy from "../../src/lib/chat-history-policy.mjs";
import { readBoundedJsonObject, BoundedJsonError } from "../../src/lib/bounded-json.server.mjs";
const source = await readFile("src/routes/api/chat/history.ts", "utf8");
const compiled = ts.transpileModule(
  source.replace(/^import[\s\S]*?from ["'][^"']+["'];\n/gmu, "").replace(/^export /gmu, ""),
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
).outputText;
const owner = "123e4567-e89b-42d3-a456-426614174000";
function fixture({ crossSite = false, denied = false, failure = false } = {}) {
  const calls = [];
  const auth = async () => {
    if (denied) return new Response(null, { status: 401 });
    return {
      userId: owner,
      supabaseAdmin: {
        rpc(name, args) {
          calls.push([name, args]);
          return {
            abortSignal: async () => {
              if (failure) throw Error("timeout");
              return { data: {}, error: null };
            },
          };
        },
      },
    };
  };
  const context = {
    ...policy,
    readBoundedJsonObject,
    BoundedJsonError,
    Response,
    Request,
    URL,
    AbortSignal,
    Error,
    crypto,
    requireUser: auth,
    requireVerifiedUser: auth,
    getCallerTier: async () => "free",
    STORAGE_LIMITS_BYTES: { free: 1000000 },
    isCrossSiteMutation: () => crossSite,
    consumeApplicationRateLimit: async () => ({ allowed: true }),
    createFileRoute: () => (value) => value,
  };
  vm.runInNewContext(compiled + "\nglobalThis.handlers=Route.server.handlers;", context);
  return { calls, handlers: context.handlers };
}
function input() {
  return {
    id: "chat",
    epoch: crypto.randomUUID(),
    mutationId: crypto.randomUUID(),
    expectedRevision: 0,
    archived: false,
    payload: {
      id: "chat",
      title: "Example",
      mode: "instant",
      createdAt: 1,
      updatedAt: 2,
      messages: [{ id: "m", role: "user", content: "private" }],
    },
  };
}
const request = (body) =>
  new Request("https://kova.test/api/chat/history", {
    method: body ? "POST" : "GET",
    ...(body
      ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }
      : {}),
  });
test("API binds writes to the verified caller and rejects cross-site, anonymous, Temporary and mismatched identities", async () => {
  for (const config of [{ crossSite: true }, { denied: true }]) {
    const f = fixture(config);
    assert.ok((await f.handlers.POST({ request: request(input()) })).status >= 400);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  const accepted = await f.handlers.POST({ request: request(input()) });
  assert.equal(accepted.status, 200);
  assert.equal(f.calls[0][1].p_owner, owner);
  for (const changed of [
    { ...input(), ownerId: crypto.randomUUID() },
    { ...input(), payload: { ...input().payload, temporary: true } },
    { ...input(), id: "different" },
  ]) {
    const g = fixture();
    assert.equal((await g.handlers.POST({ request: request(changed) })).status, 400);
    assert.equal(g.calls.length, 0);
  }
});
test("API validation errors are definite while transport uncertainty remains retryable", async () => {
  const f = fixture({ failure: true });
  assert.equal((await f.handlers.POST({ request: request(input()) })).status, 503);
  const g = fixture();
  assert.equal(
    (await g.handlers.GET({ request: new Request("https://kova.test/api/chat/history?cursor=-1") }))
      .status,
    400,
  );
  assert.equal(g.calls.length, 0);
  assert.equal(
    (await g.handlers.GET({ request: request() })).headers.get("Cache-Control"),
    "no-store",
  );
  assert.equal(g.calls[0][1].p_limit, 1);
});
