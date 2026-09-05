import assert from "node:assert/strict";
import test from "node:test";
import { resolveDurableCheckoutSession } from "../../src/lib/stripe-checkout-reconciliation.mjs";
const userId = "userFixture";
const key = "22222222-2222-4222-8222-222222222222";
function fixture({
  outcome = "new",
  expired = false,
  sessions = [],
  createError = false,
  markError = false,
} = {}) {
  const calls = [];
  const session = {
    id: "cs_fixture",
    customer: "cus_fixture",
    mode: "subscription",
    status: "open",
    client_secret: "secret",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    metadata: { userId, kovaCheckoutAttempt: key },
  };
  const stripe = {
    checkout: {
      sessions: {
        list: () => ({
          async *[Symbol.asyncIterator]() {
            calls.push("list");
            yield* sessions;
          },
        }),
        retrieve: async () => {
          calls.push("retrieve");
          return session;
        },
        create: async (params, options) => {
          calls.push(options.idempotencyKey);
          if (createError) throw new Error("cached500");
          return session;
        },
      },
    },
  };
  const supabase = {
    rpc: async (name, args) => {
      calls.push(args._outcome);
      return markError ? { error: {} } : { data: true };
    },
  };
  return {
    calls,
    session,
    input: {
      stripe,
      supabase,
      userId,
      environment: "live",
      attempt: {
        idempotencyKey: key,
        outcome,
        sessionExpiresAt: new Date(Date.now() + (expired ? -1 : 3600000)).toISOString(),
      },
      params: { customer: "cus_fixture" },
    },
  };
}
test("Session POST is preceded by durable pending state and confirmed ready afterward", async () => {
  const f = fixture();
  assert.equal((await resolveDurableCheckoutSession(f.input)).client_secret, "secret");
  assert.deepEqual(f.calls, ["pending", `kova-checkout-live-${userId}-${key}`, "ready"]);
});
test("cached500 leaves the same attempt pending and a recovered Session avoids another POST", async () => {
  const fail = fixture({ createError: true });
  await assert.rejects(resolveDurableCheckoutSession(fail.input), /reconciliation_pending/u);
  assert.equal(fail.calls.includes("ready"), false);
  const f = fixture({ outcome: "pending", sessions: [fixture().session] });
  assert.equal((await resolveDurableCheckoutSession(f.input)).client_secret, "secret");
  assert.deepEqual(f.calls, ["list", "retrieve", "ready"]);
});
test("an empty list never rotates an expired ambiguous attempt", async () => {
  const f = fixture({ outcome: "pending", expired: true });
  await assert.rejects(resolveDurableCheckoutSession(f.input), /reconciliation_pending/u);
  assert.deepEqual(f.calls, ["list"]);
});
test("a failed durable pending write prevents the Stripe POST", async () => {
  const f = fixture({ markError: true });
  await assert.rejects(resolveDurableCheckoutSession(f.input), /reconciliation_pending/u);
  assert.deepEqual(f.calls, ["pending"]);
});

test("a ready Session is retrieved and proved expired before authorizing a new attempt", async () => {
  const f = fixture({ outcome: "ready", expired: true, sessions: [fixture().session] });
  f.session.status = "expired";
  await assert.rejects(resolveDurableCheckoutSession(f.input), /reconciliation_pending/u);
  assert.deepEqual(f.calls, ["list", "retrieve", "expired"]);
});
test("a recovered Customer or attempt mismatch cannot expose a Session secret", async () => {
  const f = fixture({ outcome: "pending", sessions: [fixture().session] });
  f.session.customer = "cus_other";
  await assert.rejects(resolveDurableCheckoutSession(f.input), /reconciliation_pending/u);
  assert.deepEqual(f.calls, ["list", "retrieve"]);
});
