import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeDistributedRateLimit,
  hashRateLimitIdentity,
} from "../../src/lib/distributed-rate-limit.mjs";

const HASH_SECRET = "test-only-rate-limit-secret-32-bytes-minimum";
const SERVICE_KEY = "test-service-role-key";

function configured(overrides = {}) {
  return {
    identity: "ip:203.0.113.42",
    action: "support_submission",
    limit: 5,
    windowSeconds: 3600,
    backendUrl: "https://project.supabase.co/",
    serviceRoleKey: SERVICE_KEY,
    hashSecret: HASH_SECRET,
    ...overrides,
  };
}

test("distributed limiter sends only a keyed identity digest to the atomic RPC", async () => {
  let captured;
  const result = await consumeDistributedRateLimit(
    configured({
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return Response.json([{ allowed: true, retry_after: 321 }]);
      },
    }),
  );

  assert.deepEqual(result, { status: "allowed", allowed: true, retryAfter: 321 });
  assert.equal(
    captured.url,
    "https://project.supabase.co/rest/v1/rpc/consume_diagnostic_rate_limit",
  );
  assert.equal(captured.init.headers.apikey, SERVICE_KEY);
  assert.equal(captured.init.headers.Authorization, `Bearer ${SERVICE_KEY}`);
  const body = JSON.parse(captured.init.body);
  assert.match(body.p_identity_hash, /^[a-f0-9]{64}$/u);
  assert.equal(body.p_action, "support_submission");
  assert.equal(body.p_limit, 5);
  assert.equal(body.p_window_seconds, 3600);
  assert.doesNotMatch(captured.init.body, /203\.0\.113\.42|test-only-rate-limit-secret/u);
});

test("identity hashes are deterministic, action-scoped, and secret-keyed", async () => {
  const first = await hashRateLimitIdentity("ip:203.0.113.42", "title_generation", HASH_SECRET);
  const same = await hashRateLimitIdentity("ip:203.0.113.42", "title_generation", HASH_SECRET);
  const otherAction = await hashRateLimitIdentity(
    "ip:203.0.113.42",
    "support_submission",
    HASH_SECRET,
  );
  const otherSecret = await hashRateLimitIdentity(
    "ip:203.0.113.42",
    "title_generation",
    `${HASH_SECRET}-different`,
  );
  assert.equal(first, same);
  assert.notEqual(first, otherAction);
  assert.notEqual(first, otherSecret);
});

test("distributed limiter distinguishes an exhausted bucket from unavailable protection", async () => {
  const limited = await consumeDistributedRateLimit(
    configured({
      fetchImpl: async () => Response.json([{ allowed: false, retry_after: 45 }]),
    }),
  );
  assert.deepEqual(limited, { status: "limited", allowed: false, retryAfter: 45 });

  for (const options of [
    configured({ serviceRoleKey: undefined, fetchImpl: async () => assert.fail("must not fetch") }),
    configured({ hashSecret: undefined, fetchImpl: async () => assert.fail("must not fetch") }),
    configured({ fetchImpl: async () => new Response("down", { status: 503 }) }),
    configured({ fetchImpl: async () => Response.json([{ allowed: "yes", retry_after: 4 }]) }),
    configured({ fetchImpl: async () => Response.json([]) }),
    configured({ fetchImpl: async () => Promise.reject(new Error("network")) }),
  ]) {
    assert.deepEqual(await consumeDistributedRateLimit(options), {
      status: "unavailable",
      allowed: false,
      retryAfter: 60,
    });
  }
});

test("distributed limiter bounds the complete request and response lifecycle", async () => {
  const startedAt = Date.now();
  const result = await consumeDistributedRateLimit(
    configured({
      timeoutMs: 20,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        }),
    }),
  );
  assert.equal(result.status, "unavailable");
  assert.ok(Date.now() - startedAt < 500, "timeout must remain tightly bounded");
});
