export function stripeSubscriptionBlocksCheckout(subscription, nowSeconds) {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) return true;
  if (!subscription || typeof subscription.status !== "string") return true;
  if (subscription.status === "incomplete_expired") return false;

  const items = subscription.items;
  if (!items || items.has_more !== false || !Array.isArray(items.data) || items.data.length !== 1) {
    return true;
  }

  if (subscription.status !== "canceled") return true;
  const periodEnd = items.data[0]?.current_period_end;
  return !Number.isSafeInteger(periodEnd) || periodEnd > nowSeconds;
}
