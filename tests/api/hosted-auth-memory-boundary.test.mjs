import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { authHttp } from "../helpers/kova-auth-http.mjs";

// Real memory GET handler, API admission and installed Supabase SDK. Only the
// remote Auth/Data transports and unrelated paid summarizer are fixtures.
// This is not deployed API isolation or a live provider-signature acceptance.
const owner = "10000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const bearer = (id) =>
  [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ sub: id, exp: 4102444800, aal: "aal1", role: "authenticated" }),
    "c2lnbmF0dXJl",
  ].join(".");
const rows = [
  { user_id: owner, chat_id: "owner-chat", title: "Owner record", summary: "Owner fixture" },
  { user_id: other, chat_id: "other-chat", title: "Other record", summary: "Other fixture" },
];

function fixture({ status = 200, claimsThrow = false } = {}) {
  const calls = { auth: 0, admin: 0, data: [], signOut: 0 };
  let currentStatus = status;
  const admin = {
    from(table) {
      const filters = [];
      const q = {
        select() {
          return q;
        },
        eq(key, value) {
          filters.push([key, value]);
          return q;
        },
        order() {
          return q;
        },
        async maybeSingle() {
          assert.ok(["banned_users", "feature_flags"].includes(table));
          return { data: null, error: null };
        },
        async limit() {
          assert.equal(table, "chat_memories");
          calls.data.push(filters);
          const data = rows.filter((row) => filters.every(([key, value]) => row[key] === value));
          return { data: data.map(({ user_id, ...row }) => row), error: null };
        },
      };
      return q;
    },
  };
  const h = authHttp({
    mode: "supabase",
    env: {
      SUPABASE_URL: "https://fixture.invalid",
      SUPABASE_PUBLISHABLE_KEY: "fixture-public",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-admin",
    },
    modules: {
      "@tanstack/react-router": { createFileRoute: () => (options) => options },
      "@/lib/billing-entitlement.server": { resolveEffectiveBillingTier: async () => "plus" },
      "@/lib/ai/provider.server": {},
      "@/lib/ai/model-router.server": {},
      "@/lib/ai/model-config.mjs": {},
      "@/lib/chat-summary-policy.server.mjs": {},
      "@/lib/chat-summary.server": {},
      "@supabase/supabase-js": {
        createClient(url, key, options) {
          if (key === "fixture-admin") {
            calls.admin++;
            return admin;
          }
          const client = createClient(url, key, {
            ...options,
            global: {
              ...options.global,
              fetch: async (url, init) => {
                assert.equal(new URL(url).pathname, "/auth/v1/user");
                calls.auth++;
                if (currentStatus !== 200)
                  return Response.json(
                    {
                      message: "private upstream fixture",
                      code: currentStatus === 401 ? "bad_jwt" : "provider_unavailable",
                    },
                    { status: currentStatus, headers: { "X-Supabase-Api-Version": "2024-01-01" } },
                  );
                const token = new Headers(init.headers).get("authorization").replace("Bearer ", "");
                const id = JSON.parse(Buffer.from(token.split(".")[1], "base64url")).sub;
                return Response.json({
                  id,
                  email: `${id}@example.invalid`,
                  email_confirmed_at: "2026-01-01T00:00:00Z",
                });
              },
            },
          });
          client.auth.signOut = async () => {
            calls.signOut++;
            throw Error("Unexpected logout");
          };
          if (claimsThrow)
            client.auth.getClaims = async () => {
              throw new TypeError("private unexpected verifier detail");
            };
          return client;
        },
      },
    },
  });
  h.loadModule("@/lib/api-auth.server", "src/lib/api-auth.server.ts");
  const handler = h.loadModule("memory", "src/routes/api/memory.ts").Route.server.handlers.GET;
  const request = ({ id = owner, token = bearer(id), headers = {} } = {}) =>
    new Request("https://kova.test/api/memory", {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    });
  return {
    h,
    calls,
    get: (options) => handler({ request: request(options) }),
    recover: () => {
      currentStatus = 200;
    },
  };
}

for (const status of [503, 429]) {
  test(`hosted Auth HTTP ${status} stays unavailable rather than invalidating the caller`, async () => {
    const f = fixture({ status });
    const response = await f.get();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "Authentication is temporarily unavailable.",
    });
    assert.equal(f.calls.admin, 0);
    assert.equal(f.calls.signOut, 0);
    assert.ok(!JSON.stringify(f.h.logs).includes("private"));
    f.recover();
    const recovered = await f.get();
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).memories[0].chat_id, "owner-chat");
  });
}

test("an unexpected hosted verifier exception produces a sanitized no-store 503 before privileged access", async () => {
  const f = fixture({ claimsThrow: true });
  const response = await f.get();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "Authentication is temporarily unavailable." });
  assert.equal(f.calls.admin, 0);
  assert.ok(!JSON.stringify(f.h.logs).includes("private"));
});

test("the real memory handler scopes owner and other-account responses even when the data transport is privileged", async () => {
  const f = fixture();
  for (const [id, chat] of [
    [owner, "owner-chat"],
    [other, "other-chat"],
  ]) {
    const response = await f.get({ id });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(
      (await response.json()).memories.map((row) => row.chat_id),
      [chat],
    );
  }
  assert.deepEqual(f.calls.data, [[["user_id", owner]], [["user_id", other]]]);
});

test("anonymous and post-logout requests receive 401 without creating any Auth or data client", async () => {
  const f = fixture();
  for (const label of ["anonymous", "after owner removes its credential"]) {
    const response = await f.get({ token: null });
    assert.equal(response.status, 401, label);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(f.calls.auth, 0);
  assert.equal(f.calls.admin, 0);
});

test("explicit hosted rejection and malformed JWTs stay 401; mismatched owner binding stays 409", async () => {
  const denied = fixture({ status: 401 });
  assert.equal((await denied.get()).status, 401);
  assert.equal(denied.calls.admin, 0);
  const malformed = fixture({ status: 401 });
  assert.equal((await malformed.get({ token: "not-a-jwt" })).status, 401);
  assert.equal(malformed.calls.admin, 0);
  const mismatch = fixture();
  assert.equal((await mismatch.get({ headers: { "X-Kova-Owner": other } })).status, 409);
  assert.equal(mismatch.calls.admin, 0);
});
