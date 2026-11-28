export function normalizeDeveloperProInvoice(event, environment) {
  if (environment !== "live" || event?.livemode !== true) return null;
  if (event.type !== "invoice.paid") return null;
  const invoice = event.data?.object;
  const id = (value, prefix) => {
    const candidate = typeof value === "string" ? value : value?.id;
    return typeof candidate === "string" &&
      candidate.length <= 200 &&
      new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(candidate)
      ? candidate
      : null;
  };
  const date = (value) =>
    Number.isSafeInteger(value) && value > 0 && value <= 253402300799
      ? new Date(value * 1000).toISOString()
      : null;
  if (
    !invoice ||
    invoice.object !== "invoice" ||
    invoice.livemode !== true ||
    invoice.status !== "paid" ||
    invoice.currency !== "usd" ||
    invoice.collection_method !== "charge_automatically" ||
    !["subscription_create", "subscription_cycle"].includes(invoice.billing_reason) ||
    !Number.isSafeInteger(invoice.amount_paid) ||
    invoice.amount_paid <= 0 ||
    invoice.amount_paid > 1000000000 ||
    invoice.amount_remaining !== 0 ||
    invoice.lines?.has_more !== false ||
    !Array.isArray(invoice.lines.data) ||
    invoice.lines.data.length !== 1
  )
    return null;
  const line = invoice.lines.data[0];
  const details = line?.parent?.subscription_item_details;
  const invoiceParent = invoice.parent;
  const subscriptionId = id(invoiceParent?.subscription_details?.subscription, "sub");
  const customerId = id(invoice.customer, "cus");
  const priceId = id(line?.pricing?.price_details?.price, "price");
  const eventId = id(event.id, "evt");
  const invoiceId = id(invoice.id, "in");
  const periodStart = date(line?.period?.start);
  const periodEnd = date(line?.period?.end);
  const paidAt = date(invoice.status_transitions?.paid_at);
  const observedAt = date(event.created);
  if (
    invoiceParent?.type !== "subscription_details" ||
    line?.parent?.type !== "subscription_item_details" ||
    details?.proration !== false ||
    id(details?.subscription, "sub") !== subscriptionId ||
    line?.pricing?.type !== "price_details" ||
    line?.currency !== "usd" ||
    line?.quantity !== 1 ||
    !Number.isSafeInteger(line?.amount) ||
    line.amount <= 0 ||
    !subscriptionId ||
    !customerId ||
    !priceId ||
    !eventId ||
    !invoiceId ||
    !periodStart ||
    !periodEnd ||
    !paidAt ||
    !observedAt ||
    periodStart >= periodEnd ||
    Date.parse(periodEnd) - Date.parse(periodStart) > 32 * 86400000 ||
    paidAt > observedAt ||
    paidAt >= periodEnd
  )
    return null;
  return {
    p_event: eventId,
    p_invoice: invoiceId,
    p_customer: customerId,
    p_subscription: subscriptionId,
    p_price: priceId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_paid_at: paidAt,
    p_amount_paid: invoice.amount_paid,
  };
}

function processorId(value, prefix) {
  const id = typeof value === "string" ? value : value?.id;
  if (typeof id !== "string" || id.length > 200 || !id.startsWith(prefix + "_")) return null;
  return /^[A-Za-z0-9_]+$/.test(id.slice(prefix.length + 1)) ? id : null;
}

export function developerProPaymentReference(proof, payments) {
  if (payments?.has_more !== false || !Array.isArray(payments.data) || payments.data.length !== 1)
    return null;
  const entry = payments.data[0];
  const payment = processorId(entry?.id, "inpay");
  const intent = processorId(entry?.payment?.payment_intent, "pi");
  if (
    !payment ||
    !intent ||
    entry.object !== "invoice_payment" ||
    entry.livemode !== true ||
    entry.status !== "paid" ||
    entry.currency !== "usd" ||
    processorId(entry.invoice, "in") !== proof.p_invoice ||
    entry.amount_paid !== proof.p_amount_paid ||
    entry.payment?.type !== "payment_intent"
  )
    return null;
  return { p_payment: payment, p_intent: intent };
}

export function qualifyDeveloperProCharge(proof, reference, intent) {
  const charge = intent?.latest_charge;
  const chargeId = processorId(charge, "ch");
  if (
    !chargeId ||
    intent?.object !== "payment_intent" ||
    processorId(intent.id, "pi") !== reference.p_intent ||
    intent.livemode !== true ||
    intent.status !== "succeeded" ||
    intent.currency !== "usd" ||
    processorId(intent.customer, "cus") !== proof.p_customer ||
    intent.amount_received !== proof.p_amount_paid ||
    charge?.object !== "charge" ||
    charge.livemode !== true ||
    charge.status !== "succeeded" ||
    charge.paid !== true ||
    charge.captured !== true ||
    charge.currency !== "usd" ||
    charge.amount_captured !== proof.p_amount_paid ||
    charge.amount_refunded !== 0 ||
    charge.refunded !== false ||
    charge.disputed !== false ||
    processorId(charge.customer, "cus") !== proof.p_customer ||
    processorId(charge.payment_intent, "pi") !== reference.p_intent
  )
    return null;
  return { ...reference, p_charge: chargeId };
}

export function normalizeDeveloperProReversal(event, environment) {
  if (environment !== "live" || event?.livemode !== true) return null;
  const object = event.data?.object;
  const eventId = processorId(event.id, "evt");
  if (!eventId || !object || object.livemode !== true) return null;
  if (!Number.isSafeInteger(event.created) || event.created <= 0 || event.created > 253402300799)
    return null;
  let charge, reason;
  if (
    event.type === "charge.refunded" &&
    object.object === "charge" &&
    Number.isSafeInteger(object.amount_refunded) &&
    object.amount_refunded > 0
  ) {
    charge = processorId(object.id, "ch");
    reason = "refund";
  } else if (event.type === "charge.dispute.created" && object.object === "dispute") {
    charge = processorId(object.charge, "ch");
    reason = "dispute";
  } else return null;
  return charge
    ? {
        p_event: eventId,
        p_charge: charge,
        p_reason: reason,
        p_at: new Date(event.created * 1000).toISOString(),
      }
    : null;
}
