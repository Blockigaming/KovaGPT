import assert from "node:assert/strict";
import test from "node:test";
import { settle } from "../helpers/ui-state-harness.mjs";
import { planTierFixture } from "../helpers/plan-tier-fixture.mjs";
async function tier(summary) {
  const fixture = planTierFixture();
  fixture.requests[0].resolve({
    ownerId: "owner-a",
    tier: summary.effectiveTier,
    billingConflict: summary.billingConflict,
  });
  await settle();
  return fixture.render().tier;
}
test("billing alerts do not override a verified account entitlement", async () => {
  assert.equal(await tier({ effectiveTier: "plus", billingConflict: true }), "plus");
  assert.equal(await tier({ effectiveTier: "pro", billingConflict: true }), "pro");
});
test("unknown entitlement remains conservative and cannot grant paid access", async () => {
  assert.equal(await tier({ effectiveTier: "free", billingConflict: true }), "free");
  assert.equal(await tier({ effectiveTier: "unknown", billingConflict: false }), "free");
});
