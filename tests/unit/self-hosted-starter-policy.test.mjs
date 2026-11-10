import test from "node:test";
import assert from "node:assert/strict";
import {
  SELF_HOSTED_STARTER_MODELS,
  selfHostedStarterProfile,
  selfHostedStarterBudget,
} from "../../src/lib/ai/self-hosted-starter-policy.mjs";

test("starter modes reserve every same-checkpoint review and final synthesis", () => {
  const modes = ["instant", "thinking", "high", "extra_high", "max", "ultra"];
  let configurations = 0;
  for (const model of Object.keys(SELF_HOSTED_STARTER_MODELS)) {
    let previousReservation = 0;
    for (const mode of modes) {
      const p = selfHostedStarterProfile(model, mode);
      const budget = selfHostedStarterBudget(model, mode, 1024);
      assert.equal(p.reviewerModel, model);
      assert.equal(p.parallel, mode === "ultra");
      assert.equal(p.reviewerToolsAllowed, false);
      assert.equal(p.nativeReasoningParameters, null);
      assert.equal(budget.providerCalls, p.reviews + 1);
      assert.equal(budget.outputTokens, p.outputTokens + p.reviews * p.reviewTokens);
      assert.ok(budget.reservedTokens > previousReservation);
      previousReservation = budget.reservedTokens;
      configurations++;
    }
    assert.equal(selfHostedStarterProfile(model, "ultra").reviews, 4);
    assert.equal(selfHostedStarterProfile(model, "max").parallel, false);
    assert.deepEqual(selfHostedStarterProfile(model, "medium"), selfHostedStarterProfile(model, "thinking"));
  }
  assert.equal(configurations, 18);
});

test("invalid aliases, modes and token estimates fail closed", () => {
  for (const model of ["__proto__", "constructor", "unknown"])
    assert.throws(() => selfHostedStarterProfile(model, "instant"));
  assert.throws(() => selfHostedStarterProfile("kova-argon-4.6", "unknown"));
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(() => selfHostedStarterBudget("kova-argon-4.6", "ultra", value));
});
