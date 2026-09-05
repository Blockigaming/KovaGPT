export function paymentFixture() {
  const attempt = {
    id: "11111111-1111-4111-8111-111111111111",
    account_id: "22222222-2222-4222-8222-222222222222",
    checkout_expires_at: "2026-09-06T01:00:00Z",
    offer_snapshot: {
      environment: "sandbox",
      stripe_price_id: "price_fixture",
      currency: "USD",
      subtotal_amount: 1000,
      credits_amount: 1000,
      tax_mode: "automatic",
      tax_review_reference: "fixture jurisdiction review",
    },
  };
  const metadata = { developer_funding_attempt: attempt.id, developer_account: attempt.account_id };
  const payment = {
    id: "pi_fixture",
    status: "succeeded",
    livemode: false,
    metadata,
    amount: 1100,
    amount_received: 1100,
    currency: "usd",
    latest_charge: "ch_fixture",
  };
  const session = {
    id: "cs_test_fixture",
    livemode: false,
    mode: "payment",
    client_reference_id: attempt.id,
    metadata,
    currency: "usd",
    line_items: {
      has_more: false,
      data: [{ quantity: 1, price: { id: "price_fixture", currency: "usd", unit_amount: 1000 } }],
    },
    amount_subtotal: 1000,
    amount_total: 1100,
    total_details: { amount_tax: 100, amount_discount: 0, amount_shipping: 0 },
    automatic_tax: { enabled: true, status: "complete" },
    status: "complete",
    payment_status: "paid",
    payment_intent: payment,
  };
  const charge = {
    id: "ch_fixture",
    livemode: false,
    paid: true,
    captured: true,
    payment_intent: payment.id,
    amount: 1100,
    amount_captured: 1100,
    currency: "usd",
    amount_refunded: 0,
    disputed: false,
    balance_transaction: {
      id: "txn_fixture",
      source: "ch_fixture",
      currency: "usd",
      amount: 1100,
      fee: 35,
      net: 1065,
      exchange_rate: null,
    },
  };
  return { attempt, session, charge };
}
