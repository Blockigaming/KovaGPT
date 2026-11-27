import assert from "node:assert/strict";
import test from "node:test";
import {
  canBuyUsageCredits,
  canUseCreditsForModel,
  quoteUsageCreditDebit,
} from "../../src/lib/usage-credit-pricing.mjs";

const inputs = {
  costMicros: 1_000_000,
  topUpCents: 2_500,
  paymentFeeCents: 103,
  targetMarginBps: 1_000,
};

test("signed-in consumer tiers can purchase usage credits", () => {
  assert.equal(canBuyUsageCredits("free"), true);
  assert.equal(canBuyUsageCredits("plus"), true);
  assert.equal(canBuyUsageCredits("pro"), true);
  for (const tier of ["guest", "unknown", undefined]) {
    assert.equal(canBuyUsageCredits(tier), false);
  }
});

test("usage credits follow the current plan model entitlement", () => {
  assert.equal(canUseCreditsForModel("free", "kova-argon-4.6"), true);
  assert.equal(canUseCreditsForModel("free", "kova-xenon-6.1"), false);
  assert.equal(canUseCreditsForModel("plus", "kova-xenon-6.1"), true);
  assert.equal(canUseCreditsForModel("plus", "unknown"), false);
  assert.equal(canUseCreditsForModel("guest", "kova-argon-4.6"), false);
});

test("the minimum debit covers direct costs, allocated payment fees and the selected gross margin", () => {
  const { debitMicros, fitsWithinFundingLotFaceValue } = quoteUsageCreditDebit(inputs);
  assert.equal(debitMicros, 1_164_416);
  assert.equal(
    quoteUsageCreditDebit({ ...inputs, targetMarginBps: undefined }).debitMicros,
    debitMicros,
  );
  assert.equal(fitsWithinFundingLotFaceValue, true);
  const denominator =
    inputs.topUpCents * (10_000 - inputs.targetMarginBps) - inputs.paymentFeeCents * 10_000;
  const numerator = inputs.costMicros * inputs.topUpCents * 10_000;
  assert.ok(debitMicros * denominator >= numerator);
  assert.ok((debitMicros - 1) * denominator < numerator);
});

test("invalid costs and uneconomic funding lots fail closed", () => {
  assert.throws(() => quoteUsageCreditDebit({ ...inputs, costMicros: 0 }), RangeError);
  assert.throws(() => quoteUsageCreditDebit({ ...inputs, targetMarginBps: 10_000 }), RangeError);
  assert.throws(() => quoteUsageCreditDebit({ ...inputs, paymentFeeCents: 2_250 }), RangeError);
  assert.equal(
    quoteUsageCreditDebit({ ...inputs, costMicros: 25_000_000 }).fitsWithinFundingLotFaceValue,
    false,
  );
});
