import assert from "node:assert/strict";
import test from "node:test";
import {
  runAccountPolicyFinalizerBatch,
  validateAccountFinalizationClaim,
} from "../../src/lib/account-lifecycle-policy.mjs";

const userId = "11111111-1111-4111-8111-111111111111";
const valid = () => ({
  state: "finalizing",
  attemptId: "22222222-2222-4222-8222-222222222222",
  leaseUntil: "2026-10-19T23:59:59.000Z",
  customers: [{ environment: "live", customerId: "cus_Fixture", retiredAt: null }],
});

test("durable claims allow no customer or exactly one binding per environment", () => {
  assert.deepEqual(validateAccountFinalizationClaim(valid()), valid());
  const empty = { ...valid(), customers: [] };
  assert.deepEqual(validateAccountFinalizationClaim(empty), empty);
  const both = valid();
  both.customers.push({
    environment: "sandbox",
    customerId: "cus_Sandbox",
    retiredAt: "2026-10-19T00:00:00.000Z",
  });
  assert.deepEqual(validateAccountFinalizationClaim(both), both);
});

const invalid = [
  ["wrong state", () => ({ ...valid(), state: "scheduled" })],
  ["invalid attempt", () => ({ ...valid(), attemptId: "not-a-uuid" })],
  ["invalid lease", () => ({ ...valid(), leaseUntil: "not-a-date" })],
  ["non-string lease", () => ({ ...valid(), leaseUntil: 0 })],
  ["not an array", () => ({ ...valid(), customers: {} })],
  [
    "more than two",
    () => ({
      ...valid(),
      customers: [...valid().customers, ...valid().customers, ...valid().customers],
    }),
  ],
  [
    "duplicate environment",
    () => ({ ...valid(), customers: [...valid().customers, ...valid().customers] }),
  ],
  [
    "unknown environment",
    () => ({ ...valid(), customers: [{ ...valid().customers[0], environment: "unknown" }] }),
  ],
  [
    "invalid customer",
    () => ({ ...valid(), customers: [{ ...valid().customers[0], customerId: "unbound" }] }),
  ],
  [
    "unknown retirement",
    () => ({ ...valid(), customers: [{ ...valid().customers[0], retiredAt: undefined }] }),
  ],
  [
    "invalid retirement",
    () => ({ ...valid(), customers: [{ ...valid().customers[0], retiredAt: "not-a-date" }] }),
  ],
  ["null customer", () => ({ ...valid(), customers: [null] })],
];

for (const [label, makeClaim] of invalid) {
  test(`worker rejects ${label} before invoking the finalizer`, async () => {
    const claim = makeClaim();
    assert.throws(
      () => validateAccountFinalizationClaim(claim),
      /account_policy_(?:finalization_claim|customer_binding)_invalid/u,
    );
    const calls = [];
    const admin = {
      rpc(name) {
        return {
          async abortSignal(signal) {
            assert.ok(signal instanceof AbortSignal);
            calls.push(name);
            if (name === "kova_policy_due_deletions") return { data: [userId] };
            if (name === "kova_policy_begin_finalization") return { data: claim };
            throw new Error("unexpected fixture RPC");
          },
        };
      },
    };
    const result = await runAccountPolicyFinalizerBatch({
      admin,
      reconcileCheckout: async (owner) => assert.equal(owner, userId),
      finalize: async () => {
        calls.push("finalize");
        throw new Error("invalid claim reached finalizer");
      },
    });
    assert.deepEqual(result, { attempted: 1, completed: 0, pending: 1 });
    assert.deepEqual(calls, ["kova_policy_due_deletions", "kova_policy_begin_finalization"]);
  });
}
