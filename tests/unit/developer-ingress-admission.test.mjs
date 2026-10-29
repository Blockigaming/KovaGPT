import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { consumeOpenAiAdmission } from "../../src/lib/ai/openai-admission.server.mjs";
import { parseDeveloperCredential } from "../../src/lib/pricing/developer-platform-policy.mjs";

const keyId = "11111111-1111-4111-8111-111111111111";
const credential = `kova_${keyId}_${"a".repeat(43)}`;
const pepper = "synthetic-developer-pepper-at-least-32-characters";
const nowMs = Date.parse("2026-10-29T12:00:01Z");
const compiled = ts.transpileModule(
  await readFile(
    new URL("../../src/lib/pricing/developer-platform.server.ts", import.meta.url),
    "utf8",
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function fixture(overrides = {}) {
  const state = {
    enabled: true,
    validKey: true,
    ownerPresent: true,
    banned: false,
    deleted: false,
    lockdown: false,
    crossSite: false,
    admission: {},
    admissions: [],
    queries: [],
    providerCalls: 0,
    ...overrides,
  };
  const env = {
    KOVA_DEVELOPER_API_ENABLED: "true",
    KOVA_DEVELOPER_BILLING_ENABLED: "true",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
    DEVELOPER_KEY_PEPPER: pepper,
  };
  const db = {
    from(table) {
      state.queries.push(table);
      const query = {};
      for (const method of ["select", "eq", "is", "gt", "abortSignal"]) query[method] = () => query;
      query.maybeSingle = async () => ({
        error: null,
        data:
          table === "developer_billing_keys"
            ? {
                id: keyId,
                account_id: "account",
                project_id: "project",
                capabilities: ["chat"],
                secret_digest: crypto
                  .createHmac("sha256", pepper)
                  .update(`key\n${state.validKey ? credential : "wrong"}`)
                  .digest("hex"),
              }
            : table === "developer_account_owners"
              ? { owner_id: "owner" }
              : table === "banned_users" && state.banned
                ? { user_id: "owner" }
                : table === "account_deletion_fences" && state.deleted
                  ? { user_id: "owner" }
                  : null,
      });
      return query;
    },
  };
  const consume = async (input) => {
    state.admissions.push(JSON.parse(JSON.stringify(input)));
    const decision = state.admission[input.action] ?? "allowed";
    let current;
    return consumeOpenAiAdmission({
      ...input,
      backendUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      hashSecret: "synthetic-hash-secret-at-least-32-characters",
      nowMs,
      fetchImpl: async (_url, init) => {
        if (decision === "unavailable") throw new Error("synthetic storage unavailable");
        if (init.method === "POST") {
          current = JSON.parse(init.body);
          if (decision === "limited") {
            current.request_count = 120;
            return Response.json([]);
          }
          return Response.json([current]);
        }
        assert.equal(init.method, "GET");
        return Response.json([current]);
      },
    });
  };
  const deps = {
    "node:crypto": crypto,
    "@/lib/runtime-env.server": {
      runtimeEnv: (name) => (state.enabled ? env[name] : undefined),
    },
    "@supabase/supabase-js": { createClient: () => db },
    "@/lib/ai/openai-admission-runtime.server": { consumeOpenAiApplicationAdmission: consume },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () =>
        assert.fail("developer authentication must not use the short-window RPC limiter"),
    },
    "./developer-platform-policy.mjs": { parseDeveloperCredential },
    "@/lib/chat-ingress.server.mjs": { resolveAnonymousClientKey: () => "synthetic-client" },
    "@/lib/auth-security.mjs": { isCrossSiteMutation: () => state.crossSite },
    "@/lib/account-identity.server.mjs": {
      readAccountIdentity: async () => (state.ownerPresent ? { id: "owner" } : null),
    },
    "@/lib/lockdown-policy.mjs": {
      assertLockdownAllows: async (_db, owner, capability) => {
        assert.equal(owner, "owner");
        assert.equal(capability, "agent");
        if (state.lockdown) throw new Error("developer_unauthorized");
      },
    },
    "@/lib/ai/provider.server": {
      developerResponses: async () => {
        state.providerCalls++;
        assert.fail("denied request reached provider");
      },
      embeddings: async () => {
        state.providerCalls++;
        assert.fail("denied request reached provider");
      },
      imageGenerations: async () => {
        state.providerCalls++;
        assert.fail("denied request reached provider");
      },
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    Buffer,
    Response,
    URL,
    Date,
    AbortSignal,
    Error,
    require: (name) => deps[name] ?? {},
  });
  const request = (headers = {}) =>
    new Request("https://kova.test/api/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ model: "synthetic", input: "hello" }),
    });
  return { state, exports, request };
}

test("developer authentication reaches owner checks through both exact durable minute contracts", async () => {
  const f = fixture();
  const identity = await f.exports.authenticateDeveloper(f.request());
  assert.equal(identity.id, keyId);
  assert.equal(identity.ownerId, "owner");
  assert.deepEqual(f.state.admissions, [
    {
      identity: `developer-auth:${crypto.createHash("sha256").update("synthetic-client").digest("hex")}`,
      action: "developer_authentication",
      limit: 120,
      windowSeconds: 60,
    },
    { identity: `developer:${keyId}`, action: "developer_ingress", limit: 120, windowSeconds: 60 },
  ]);
  assert.deepEqual(f.state.queries, [
    "developer_billing_keys",
    "developer_account_owners",
    "account_deletion_fences",
    "banned_users",
  ]);
  assert.equal(f.state.providerCalls, 0);
});

test("denied minute admission fails before key lookup or provider dispatch without retries", async () => {
  for (const action of ["developer_authentication", "developer_ingress"]) {
    for (const decision of ["limited", "unavailable"]) {
      const f = fixture({ admission: { [action]: decision } });
      const response = await f.exports.handleDeveloperApi(f.request(), "responses");
      assert.equal(response.status, decision === "limited" ? 429 : 503);
      assert.equal(
        (await response.json()).error.code,
        decision === "limited" ? "developer_rate_limit" : "developer_rate_unavailable",
      );
      assert.equal(f.state.admissions.length, action === "developer_authentication" ? 1 : 2);
      assert.deepEqual(
        f.state.queries,
        action === "developer_authentication" ? [] : ["developer_billing_keys"],
      );
      assert.equal(f.state.providerCalls, 0);
    }
  }
});

test("feature, origin, credential and owner fences remain in force before provider dispatch", async () => {
  for (const [overrides, headers, expected] of [
    [{ enabled: false }, {}, 503],
    [{ crossSite: true }, { origin: "https://untrusted.test" }, 400],
    [{}, { authorization: "Bearer invalid" }, 401],
    [{ validKey: false }, {}, 401],
    [{ ownerPresent: false }, {}, 401],
    [{ deleted: true }, {}, 401],
    [{ banned: true }, {}, 401],
    [{ lockdown: true }, {}, 401],
  ]) {
    const f = fixture(overrides);
    const response = await f.exports.handleDeveloperApi(f.request(headers), "responses");
    assert.equal(response.status, expected);
    assert.equal(f.state.providerCalls, 0);
    if (!f.state.validKey) assert.equal(f.state.admissions.length, 1);
    if (!f.state.enabled || f.state.crossSite || headers.authorization)
      assert.equal(f.state.admissions.length, 0);
  }
});
