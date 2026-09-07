import assert from "node:assert/strict";
import test from "node:test";
import { prepareStripeAccountDeletion } from "../../src/lib/stripe-account-deletion-preflight.mjs";
function fixture({
  pending = false,
  mappings = [{ environment: "live", stripe_customer_id: "cus_known" }],
  rows = [],
  missingSandbox = false,
} = {}) {
  const calls = [];
  const query = {
    select() {
      return this;
    },
    eq(key, value) {
      assert.equal(key, "user_id");
      assert.equal(value, "user");
      return this;
    },
    order(key, opts) {
      assert.equal(key, "id");
      assert.equal(opts.ascending, true);
      return this;
    },
    range: async (from, to) => {
      calls.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    },
  };
  const input = {
    userId: "user",
    supabase: {
      rpc: async (name) => {
        assert.equal(name, "prepare_stripe_account_deletion");
        calls.push("fence");
        return pending ? { error: {} } : { data: mappings };
      },
      from: () => query,
    },
    createStripeClient: (environment) => {
      calls.push(environment);
      if (environment === "sandbox" && missingSandbox) throw new Error("missing key");
      return {
        customers: {
          retrieve: async (id) => {
            calls.push(id);
            return { id };
          },
        },
      };
    },
  };
  return { input, calls };
}
test("an unsettled first-Customer reservation blocks all Stripe and cleanup work", async () => {
  const f = fixture({ pending: true });
  await assert.rejects(prepareStripeAccountDeletion(f.input), /preflight_pending/u);
  assert.deepEqual(f.calls, ["fence"]);
});
test("an exact mapped Customer is verified only after the durable fence and all local pages", async () => {
  const f = fixture({
    rows: Array.from({ length: 201 }, () => ({
      environment: "live",
      stripe_customer_id: "cus_known",
      status: "active",
    })),
  });
  const result = await prepareStripeAccountDeletion(f.input);
  assert.equal(result[0].customerId, "cus_known");
  assert.deepEqual(f.calls, ["fence", "live", [0, 199], [200, 399], "cus_known"]);
});
test("an older active row for a different Customer cannot be hidden by an environment mapping", async () => {
  const f = fixture({
    rows: [
      ...Array.from({ length: 200 }, () => ({ status: "canceled" })),
      { environment: "live", stripe_customer_id: "cus_other", status: "active" },
    ],
  });
  await assert.rejects(prepareStripeAccountDeletion(f.input), /customer_mismatch/u);
  assert.equal(f.calls.includes("cus_known"), false);
});
test("unavailable historical sandbox credentials fail before Customer or connector teardown", async () => {
  const f = fixture({
    missingSandbox: true,
    mappings: [
      { environment: "live", stripe_customer_id: "cus_known" },
      { environment: "sandbox", stripe_customer_id: "cus_old" },
    ],
  });
  await assert.rejects(prepareStripeAccountDeletion(f.input), /missing key/u);
  assert.deepEqual(f.calls, ["fence", "live", "sandbox"]);
});
