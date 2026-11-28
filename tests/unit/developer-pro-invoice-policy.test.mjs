import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDeveloperProInvoice,
  developerProPaymentReference,
  qualifyDeveloperProCharge,
  normalizeDeveloperProReversal,
} from "../../src/lib/pricing/developer-pro-invoice-policy.mjs";

const start = Date.parse("2026-11-01T00:00:00Z") / 1000;
function fixture() {
  return {
    id: "evt_fixture",
    created: start + 120,
    livemode: true,
    type: "invoice.paid",
    data: {
      object: {
        object: "invoice",
        id: "in_fixture",
        livemode: true,
        status: "paid",
        currency: "usd",
        collection_method: "charge_automatically",
        billing_reason: "subscription_cycle",
        amount_paid: 8000,
        amount_remaining: 0,
        customer: "cus_fixture",
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: "sub_fixture" },
        },
        status_transitions: { paid_at: start + 60 },
        lines: {
          has_more: false,
          data: [
            {
              parent: {
                type: "subscription_item_details",
                subscription_item_details: { subscription: "sub_fixture", proration: false },
              },
              pricing: { type: "price_details", price_details: { price: "price_fixture" } },
              currency: "usd",
              quantity: 1,
              amount: 8000,
              period: { start, end: start + 30 * 86400 },
            },
          ],
        },
      },
    },
  };
}

test("paid recurring invoice binds processor identities and the exact service period", () => {
  const value = normalizeDeveloperProInvoice(fixture(), "live");
  assert.equal(value.p_invoice, "in_fixture");
  assert.equal(value.p_customer, "cus_fixture");
  assert.equal(value.p_subscription, "sub_fixture");
  assert.equal(value.p_price, "price_fixture");
  assert.equal(value.p_period_start, "2026-11-01T00:00:00.000Z");
  assert.equal(value.p_period_end, "2026-12-01T00:00:00.000Z");
  assert.equal(value.p_amount_paid, 8000);
  assert.equal(normalizeDeveloperProInvoice(fixture(), "sandbox"), null);
});

test("nonpaid, truncated, prorated and mismatched invoices fail closed", () => {
  for (const mutate of [
    (event) => (event.livemode = false),
    (event) => (event.type = "invoice.payment_failed"),
    (event) => (event.data.object.status = "open"),
    (event) => (event.data.object.amount_paid = 0),
    (event) => (event.data.object.lines.has_more = true),
    (event) => (event.data.object.lines.data[0].parent.subscription_item_details.proration = true),
    (event) => {
      event.data.object.lines.data[0].parent.subscription_item_details.subscription = "sub_other";
    },
    (event) => (event.data.object.lines.data[0].period.end = start + 60 * 86400),
    (event) => (event.data.object.status_transitions.paid_at = start + 200),
    (event) => event.data.object.lines.data.push(event.data.object.lines.data[0]),
    (event) => (event.data.object.currency = "eur"),
    (event) => (event.data.object.collection_method = "send_invoice"),
  ]) {
    const event = fixture();
    mutate(event);
    assert.equal(normalizeDeveloperProInvoice(event, "live"), null);
  }
});

test("paid invoice eligibility requires an exact captured and unreversed Stripe payment", () => {
  const proof = { p_invoice: "in_fixture", p_customer: "cus_fixture", p_amount_paid: 8000 };
  const payment = {
    object: "invoice_payment",
    id: "inpay_fixture",
    invoice: proof.p_invoice,
    livemode: true,
    status: "paid",
    currency: "usd",
    amount_paid: 8000,
    payment: { type: "payment_intent", payment_intent: "pi_fixture" },
  };
  const reference = developerProPaymentReference(proof, { has_more: false, data: [payment] });
  assert.deepEqual(reference, { p_payment: "inpay_fixture", p_intent: "pi_fixture" });
  for (const bad of [
    { has_more: true, data: [payment] },
    { has_more: false, data: [payment, payment] },
    { has_more: false, data: [{ ...payment, payment: { type: "payment_record" } }] },
    { has_more: false, data: [{ ...payment, invoice: "in_other" }] },
    { has_more: false, data: [{ ...payment, amount_paid: 10 }] },
  ])
    assert.equal(developerProPaymentReference(proof, bad), null);
  const charge = {
    object: "charge",
    id: "ch_fixture",
    livemode: true,
    status: "succeeded",
    paid: true,
    captured: true,
    currency: "usd",
    amount_captured: 8000,
    amount_refunded: 0,
    refunded: false,
    disputed: false,
    customer: "cus_fixture",
    payment_intent: "pi_fixture",
  };
  const intent = {
    object: "payment_intent",
    id: "pi_fixture",
    livemode: true,
    status: "succeeded",
    currency: "usd",
    customer: "cus_fixture",
    amount_received: 8000,
    latest_charge: charge,
  };
  assert.deepEqual(qualifyDeveloperProCharge(proof, reference, intent), {
    ...reference,
    p_charge: "ch_fixture",
  });
  for (const patch of [
    { captured: false },
    { amount_refunded: 1 },
    { refunded: true },
    { disputed: true },
    { customer: "cus_other" },
    { payment_intent: "pi_other" },
    { amount_captured: 7999 },
  ])
    assert.equal(
      qualifyDeveloperProCharge(proof, reference, {
        ...intent,
        latest_charge: { ...charge, ...patch },
      }),
      null,
    );
  const refund = {
    id: "evt_fixture",
    created: start + 120,
    livemode: true,
    type: "charge.refunded",
    data: { object: { ...charge, amount_refunded: 1 } },
  };
  assert.equal(normalizeDeveloperProReversal(refund, "live").p_charge, "ch_fixture");
  assert.equal(normalizeDeveloperProReversal(refund, "sandbox"), null);
  const dispute = {
    ...refund,
    type: "charge.dispute.created",
    data: { object: { object: "dispute", livemode: true, charge: "ch_fixture" } },
  };
  assert.equal(normalizeDeveloperProReversal(dispute, "live").p_reason, "dispute");
});
