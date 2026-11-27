export function normalizeDeveloperProInvoice(event, environment) {
  if (environment !== "live" || event?.livemode !== true || event.type !== "invoice.paid")
    return null;
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
