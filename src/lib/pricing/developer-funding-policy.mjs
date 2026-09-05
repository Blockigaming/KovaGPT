const fail = (code) => {
  throw new Error(code);
};
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const integer = (value, max = 1000000000) =>
  Number.isSafeInteger(value) && value >= 0 && value <= max;
const reference = (value, prefix) =>
  typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(value);
export function fundingCheckoutParameters(attempt, origin) {
  const offer = attempt.offer_snapshot;
  const base = new URL(origin);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    fail("developer_payment_origin_invalid");
  if (
    !object(offer) ||
    !reference(offer.stripe_price_id, "price") ||
    !["automatic", "reviewed_exempt"].includes(offer.tax_mode) ||
    !offer.tax_review_reference
  )
    fail("developer_payment_offer_invalid");
  const metadata = {
    developer_funding_attempt: attempt.id,
    developer_account: attempt.account_id,
    integration_identifier: "kovadevcreditabcdefgh",
  };
  return {
    mode: "payment",
    line_items: [{ price: offer.stripe_price_id, quantity: 1 }],
    client_reference_id: attempt.id,
    metadata,
    payment_intent_data: { metadata },
    expires_at: Math.floor(Date.parse(attempt.checkout_expires_at) / 1000),
    automatic_tax: { enabled: offer.tax_mode === "automatic" },
    success_url: `${base.origin}/developers/console?funding=returned`,
    cancel_url: `${base.origin}/developers/console?funding=canceled`,
  };
}

/** Uses expanded, authenticated processor records; no client prices, return-page claim or event body is evidence. */
export function verifiedFundingReceipt(
  attempt,
  session,
  charge,
  dispute = null,
  adjustmentTransactions = [],
) {
  const offer = attempt.offer_snapshot,
    live = offer.environment === "live";
  if (
    !object(session) ||
    !reference(session.id, "cs") ||
    session.livemode !== live ||
    session.mode !== "payment" ||
    session.client_reference_id !== attempt.id ||
    session.metadata?.developer_funding_attempt !== attempt.id ||
    session.metadata?.developer_account !== attempt.account_id ||
    session.currency?.toUpperCase() !== offer.currency
  )
    fail("developer_payment_identity_invalid");
  const lines = session.line_items;
  if (
    !object(lines) ||
    lines.has_more !== false ||
    !Array.isArray(lines.data) ||
    lines.data.length !== 1 ||
    lines.data[0].quantity !== 1 ||
    lines.data[0].price?.id !== offer.stripe_price_id ||
    lines.data[0].price?.currency?.toUpperCase() !== offer.currency ||
    lines.data[0].price?.unit_amount !== offer.subtotal_amount ||
    session.amount_subtotal !== offer.subtotal_amount ||
    !integer(session.amount_total) ||
    !integer(session.total_details?.amount_tax) ||
    session.amount_total !== session.amount_subtotal + session.total_details.amount_tax ||
    (session.total_details.amount_discount ?? 0) !== 0 ||
    (session.total_details.amount_shipping ?? 0) !== 0 ||
    (offer.tax_mode === "automatic"
      ? session.automatic_tax?.enabled !== true
      : session.total_details.amount_tax !== 0)
  )
    fail("developer_payment_amount_invalid");
  if (session.status === "expired" && session.payment_status === "unpaid")
    return { state: "expired", receipt: null };
  if (session.status === "open" && session.payment_status === "unpaid") {
    const url = new URL(session.url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "checkout.stripe.com" ||
      url.username ||
      url.password
    )
      fail("developer_payment_redirect_invalid");
    return { state: "open", url: url.href, receipt: null };
  }
  if (session.status !== "complete" || session.payment_status !== "paid")
    fail("developer_payment_not_settled");
  if (offer.tax_mode === "automatic" && session.automatic_tax.status !== "complete")
    fail("developer_payment_tax_unverified");
  const payment = session.payment_intent;
  if (
    !object(payment) ||
    !reference(payment.id, "pi") ||
    payment.status !== "succeeded" ||
    payment.livemode !== live ||
    payment.metadata?.developer_funding_attempt !== attempt.id ||
    payment.metadata?.developer_account !== attempt.account_id ||
    payment.amount !== session.amount_total ||
    payment.amount_received !== session.amount_total ||
    payment.currency?.toUpperCase() !== offer.currency
  )
    fail("developer_payment_intent_invalid");
  if (
    !object(charge) ||
    !reference(charge.id, "ch") ||
    charge.livemode !== live ||
    !charge.paid ||
    !charge.captured ||
    charge.payment_intent !== payment.id ||
    charge.amount !== session.amount_total ||
    charge.amount_captured !== session.amount_total ||
    charge.currency?.toUpperCase() !== offer.currency ||
    !integer(charge.amount_refunded) ||
    charge.amount_refunded > charge.amount ||
    (typeof payment.latest_charge === "string"
      ? payment.latest_charge
      : payment.latest_charge?.id) !== charge.id
  )
    fail("developer_payment_charge_invalid");
  const tx = charge.balance_transaction;
  if (
    !object(tx) ||
    !reference(tx.id, "txn") ||
    tx.source !== charge.id ||
    tx.currency?.toUpperCase() !== offer.currency ||
    tx.amount !== charge.amount ||
    !integer(tx.fee) ||
    tx.fee > tx.amount ||
    tx.net !== tx.amount - tx.fee ||
    tx.exchange_rate != null
  )
    fail("developer_payment_fee_unverified");
  let disputed = 0,
    disputeStatus = "none";
  if (charge.disputed) {
    if (
      !object(dispute) ||
      !reference(dispute.id, "dp") ||
      dispute.charge !== charge.id ||
      dispute.currency?.toUpperCase() !== offer.currency ||
      !integer(dispute.amount) ||
      dispute.amount > charge.amount ||
      ![
        "warning_needs_response",
        "warning_under_review",
        "warning_closed",
        "needs_response",
        "under_review",
        "won",
        "lost",
      ].includes(dispute.status)
    )
      fail("developer_payment_dispute_unverified");
    disputeStatus = dispute.status;
    if (["needs_response", "under_review", "lost"].includes(dispute.status))
      disputed = dispute.amount;
  }
  let additionalFees = 0;
  const seen = new Set();
  for (const item of adjustmentTransactions) {
    if (
      !object(item) ||
      !reference(item.id, "txn") ||
      seen.has(item.id) ||
      item.currency?.toUpperCase() !== offer.currency ||
      !Number.isSafeInteger(item.fee) ||
      Math.abs(item.fee) > 1000000000 ||
      item.exchange_rate != null
    )
      fail("developer_payment_adjustment_fee_unverified");
    seen.add(item.id);
    additionalFees += item.fee;
  }
  return {
    state: "paid",
    receipt: {
      environment: offer.environment,
      currency: offer.currency,
      sessionId: session.id,
      paymentIntentId: payment.id,
      chargeId: charge.id,
      balanceTransactionId: tx.id,
      subtotal: session.amount_subtotal,
      gross: charge.amount,
      tax: session.total_details.amount_tax,
      fee: tx.fee,
      net: tx.net,
      refundedGross: charge.amount_refunded,
      reversedGross: Math.min(charge.amount, charge.amount_refunded + disputed),
      disputeStatus,
      additionalFees,
    },
  };
}
