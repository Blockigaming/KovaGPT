import assert from "node:assert/strict";
import test from "node:test";
import { resolveStripeCustomerId } from "../../src/lib/stripe-customer-mapping.mjs";

const userId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
function fixture({
  mapped = null,
  claimError = false,
  existing = [],
  expired = false,
  createError = false,
  completeError = false,
} = {}) {
  const calls = [];
  const customer = {
    id: "cus_New",
    metadata: { userId, environment: "live", kovaCustomerCreation: requestId },
  };
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle: async () => ({ data: mapped ? { stripe_customer_id: mapped } : null }),
  };
  const supabase = {
    from: () => query,
    rpc: async (name, args) => {
      calls.push(name);
      if (name === "claim_stripe_customer_creation")
        return claimError
          ? { error: { message: "account_deletion_pending" } }
          : {
              data: {
                requestId,
                requestedAt: new Date(
                  Date.now() - (expired ? 25 * 60 * 60 * 1000 : 0),
                ).toISOString(),
                state: "pending",
              },
            };
      assert.equal(name, "complete_stripe_customer_creation");
      assert.equal(args._request_id, requestId);
      return completeError
        ? { error: { message: "account_deletion_pending" } }
        : { data: args._customer_id };
    },
  };
  const stripe = {
    customers: {
      search: async ({ query }) => {
        calls.push("search");
        assert.match(query, /kovaCustomerCreation/u);
        return { data: existing, has_more: false };
      },
      create: async (params, options) => {
        calls.push("create");
        assert.deepEqual(params.metadata, customer.metadata);
        assert.equal(options.idempotencyKey, `kova-customer-live-${requestId}`);
        if (createError) throw new Error("cached 500");
        return customer;
      },
    },
  };
  return {
    input: { stripe, supabase, userId, environment: "live", email: "contact@example.test" },
    calls,
    customer,
  };
}

test("an immutable mapped Customer bypasses contact-email lookup and new creation", async () => {
  const f = fixture({ mapped: "cus_Existing" });
  assert.equal(await resolveStripeCustomerId(f.input), "cus_Existing");
  assert.deepEqual(f.calls, []);
});
test("Customer creation reserves durably before Stripe and finalizes exact request identity", async () => {
  const f = fixture();
  assert.equal(await resolveStripeCustomerId(f.input), "cus_New");
  assert.deepEqual(f.calls, [
    "claim_stripe_customer_creation",
    "search",
    "create",
    "complete_stripe_customer_creation",
  ]);
});
test("an account-deletion fence stops the first Customer network request", async () => {
  const f = fixture({ claimError: true });
  await assert.rejects(resolveStripeCustomerId(f.input), /creation_claim_failed/u);
  assert.deepEqual(f.calls, ["claim_stripe_customer_creation"]);
});
test("an expired unknown Customer request is never reissued with a new key", async () => {
  const f = fixture({ expired: true });
  await assert.rejects(resolveStripeCustomerId(f.input), /reconciliation_pending/u);
  assert.deepEqual(f.calls, ["claim_stripe_customer_creation", "search"]);
});
test("a recovered exact Customer can finalize after the idempotency window", async () => {
  const customer = fixture().customer;
  const f = fixture({ expired: true, existing: [customer] });
  assert.equal(await resolveStripeCustomerId(f.input), customer.id);
  assert.equal(f.calls.includes("create"), false);
});
test("a cached500 or a deletion race cannot report a completed Customer mapping", async () => {
  for (const options of [{ createError: true }, { completeError: true }]) {
    const f = fixture(options);
    await assert.rejects(resolveStripeCustomerId(f.input));
  }
});
