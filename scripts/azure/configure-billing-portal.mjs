import Stripe from "stripe";
const key = process.env.STRIPE_LIVE_API_KEY;
if (!key || !/^(?:sk|rk)_live_/.test(key))
  throw new Error(
    "Use the existing restricted server Stripe credential; never pass it as a command argument.",
  );
const stripe = new Stripe(key, {
  apiVersion: "2026-08-26.dahlia",
  maxNetworkRetries: 0,
  timeout: 10000,
});
const id = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
const apply = process.argv.includes("--apply");
try {
  const configuration = id
    ? await stripe.billingPortal.configurations.retrieve(id)
    : (await stripe.billingPortal.configurations.list({ active: true, is_default: true, limit: 2 }))
        .data[0];
  if (!configuration?.active || !configuration.livemode)
    throw new Error("An active live portal configuration is required.");
  const products = [];
  for (const [lookupKey, amount] of [
    ["plus_monthly", 1600],
    ["pro_monthly", 8000],
  ]) {
    const prices = await stripe.prices.list({ active: true, lookup_keys: [lookupKey], limit: 2 });
    const price = prices.data[0];
    if (
      prices.has_more ||
      prices.data.length !== 1 ||
      !price.livemode ||
      price.currency !== "usd" ||
      price.unit_amount !== amount ||
      price.recurring?.interval !== "month"
    )
      throw new Error("The existing live plan catalog could not be verified.");
    products.push({
      product: typeof price.product === "string" ? price.product : price.product.id,
      prices: [price.id],
    });
  }
  const update = {
    business_profile: {
      privacy_policy_url: "https://kovagpt.com/privacy",
      terms_of_service_url: "https://kovagpt.com/terms",
    },
    features: {
      subscription_update: { enabled: true, default_allowed_updates: ["price"], products },
    },
  };
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "review",
        configuration: configuration.id,
        update,
        pricesOrSubscriptionsChanged: false,
      },
      null,
      2,
    ),
  );
  if (apply) {
    const saved = await stripe.billingPortal.configurations.update(configuration.id, update);
    if (
      !saved.active ||
      !saved.features.subscription_update.default_allowed_updates.includes("price")
    )
      throw new Error("Portal update was not confirmed.");
    console.log(
      "Plan selection is enabled in the existing portal. Test the signed-in review and webhook reconciliation before marking billing live.",
    );
  }
} catch {
  console.error(
    "Billing portal configuration could not be verified or updated. No raw Stripe response or credential is printed.",
  );
  process.exitCode = 1;
}
