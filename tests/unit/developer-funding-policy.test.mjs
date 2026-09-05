import assert from "node:assert/strict";
import test from "node:test";
import {
  fundingCheckoutParameters,
  verifiedFundingReceipt,
} from "../../src/lib/pricing/developer-funding-policy.mjs";
import { paymentFixture } from "../helpers/developer-funding-fixture.mjs";
import { fundingAdjustedVersion } from "../../src/lib/pricing/developer-funding-allowance.mjs";

test("observed funding costs can only raise the approved collection floor without mutating its version", () => {
  const version = {
    id: "approved",
    allowance_configuration: { collectionPercentage: 0.03, collectionFixed: 0.01 },
  };
  assert.equal(fundingAdjustedVersion(version, {}), version);
  assert.equal(fundingAdjustedVersion(version, { funding_collection_rate: "0.02" }), version);
  const result = fundingAdjustedVersion(version, { funding_collection_rate: "0.1" });
  assert.equal(result.id, version.id);
  assert.equal(result.allowance_configuration.collectionPercentage, 0.1);
  assert.equal(result.allowance_configuration.collectionFixed, 0.01);
  assert.equal(version.allowance_configuration.collectionPercentage, 0.03);
  for (const rate of [-1, "unknown", Infinity])
    assert.throws(() => fundingAdjustedVersion(version, { funding_collection_rate: rate }));
});

test("checkout parameters are stable and contain only the approved price and a pinned return origin", () => {
  const { attempt } = paymentFixture();
  const params = fundingCheckoutParameters(attempt, "https://kovagpt.com");
  assert.deepEqual(params, fundingCheckoutParameters(attempt, "https://kovagpt.com/"));
  assert.deepEqual(params.line_items, [{ price: "price_fixture", quantity: 1 }]);
  assert.equal(params.payment_method_types, undefined);
  assert.equal(params.automatic_tax.enabled, true);
  for (const origin of [
    "http://kovagpt.com",
    "https://evil@kovagpt.com",
    "https://kovagpt.com/redirect?url=https://evil.invalid",
  ])
    assert.throws(() => fundingCheckoutParameters(attempt, origin));
});
test("only complete same-environment processor evidence grants a receipt and uses the actual aggregate fee", () => {
  const { attempt, session, charge } = paymentFixture(),
    result = verifiedFundingReceipt(attempt, session, charge);
  assert.equal(result.state, "paid");
  assert.equal(result.receipt.fee, 35);
  assert.equal(result.receipt.tax, 100);
  assert.equal(result.receipt.net, 1065);
  for (const patch of [
    { livemode: true },
    { paid: false },
    { captured: false },
    { currency: "eur" },
    { amount_refunded: 1200 },
    { balance_transaction: { ...charge.balance_transaction, fee: null } },
    { balance_transaction: { ...charge.balance_transaction, exchange_rate: 1.1 } },
  ])
    assert.throws(() => verifiedFundingReceipt(attempt, session, { ...charge, ...patch }));
  for (const patch of [
    { metadata: {} },
    { line_items: { has_more: true, data: session.line_items.data } },
    { payment_status: "unpaid" },
    { amount_subtotal: 999 },
    { automatic_tax: { enabled: true, status: "requires_location_inputs" } },
  ])
    assert.throws(() => verifiedFundingReceipt(attempt, { ...session, ...patch }, charge));
});
test("an unpaid hosted checkout may request tax location but cannot grant any credit", () => {
  const { attempt, session } = paymentFixture();
  const result = verifiedFundingReceipt(
    attempt,
    {
      ...session,
      status: "open",
      payment_status: "unpaid",
      url: "https://checkout.stripe.com/c/pay/cs_test_fixture",
      automatic_tax: { enabled: true, status: "requires_location_inputs" },
    },
    null,
  );
  assert.equal(result.state, "open");
  assert.equal(result.receipt, null);
  assert.throws(() =>
    verifiedFundingReceipt(
      attempt,
      { ...session, status: "open", payment_status: "unpaid", url: "https://evil.invalid" },
      null,
    ),
  );
});
test("refund and dispute evidence clamps overlapping liability and verified victory releases only the dispute", () => {
  const { attempt, session, charge } = paymentFixture();
  charge.disputed = true;
  charge.amount_refunded = 500;
  const dispute = {
    id: "dp_fixture",
    charge: charge.id,
    currency: "usd",
    amount: 1100,
    status: "under_review",
  };
  assert.equal(
    verifiedFundingReceipt(attempt, session, charge, dispute).receipt.reversedGross,
    1100,
  );
  assert.equal(
    verifiedFundingReceipt(attempt, session, charge, { ...dispute, status: "won" }).receipt
      .reversedGross,
    500,
  );
  assert.throws(() => verifiedFundingReceipt(attempt, session, charge));
  assert.throws(() =>
    verifiedFundingReceipt(attempt, session, charge, { ...dispute, status: "unknown" }),
  );
});
