/** Builds a Stripe-hosted review flow; never updates a subscription or charges a card. */
export async function subscriptionPortalFlow(stripe, customerId, plan, allowedProducts) {
  if (!/^cus_[a-zA-Z0-9]+$/.test(customerId) || !plan?.livePriceId)
    throw new Error("billing_change_invalid");
  const price = await stripe.prices.retrieve(plan.livePriceId);
  const productId = typeof price.product === "string" ? price.product : price.product?.id;
  if (
    !price.active ||
    !price.livemode ||
    price.lookup_key !== plan.lookupKey ||
    price.currency !== "usd" ||
    price.recurring?.interval !== "month" ||
    !allowedProducts.includes(productId)
  )
    throw new Error("billing_change_price_unavailable");
  const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
  if (list.has_more) throw new Error("billing_change_ambiguous");
  const active = list.data.filter((subscription) =>
    ["active", "trialing", "past_due"].includes(subscription.status),
  );
  if (
    active.length !== 1 ||
    !active[0].livemode ||
    active[0].items?.data?.length !== 1 ||
    active[0].items.has_more
  )
    throw new Error("billing_change_ambiguous");
  const subscription = active[0],
    item = subscription.items.data[0];
  const owner =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  const currentProduct =
    typeof item.price?.product === "string" ? item.price.product : item.price?.product?.id;
  if (
    owner !== customerId ||
    !allowedProducts.includes(currentProduct) ||
    item.quantity !== 1 ||
    !/^si_[a-zA-Z0-9]+$/.test(item.id)
  )
    throw new Error("billing_change_ambiguous");
  return {
    type: "subscription_update_confirm",
    subscription_update_confirm: {
      subscription: subscription.id,
      items: [{ id: item.id, price: plan.livePriceId, quantity: 1 }],
    },
  };
}
