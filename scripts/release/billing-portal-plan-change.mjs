#!/usr/bin/env node
// Review by default; apply only during the authorized billing release. This
// edits portal choices, never subscriptions, payments, prices or entitlements.
import Stripe from "stripe";
import { resolve } from "node:path";
const account = "acct_1UAeDgAEZlsb6DBY";
const prices = ["price_1UAzhHAEZlsb6DBYWw2oUCeO", "price_1UEw6FAEZlsb6DBYuksCKOBR"];
export function portalPlanChange(configuration, catalog) {
  if (
    !configuration?.active ||
    !configuration.livemode ||
    !configuration.features?.subscription_update?.enabled
  )
    throw Error("portal_not_ready");
  if (
    catalog.length !== 2 ||
    new Set(catalog.map((price) => price.id)).size !== 2 ||
    catalog.some(
      (price) =>
        !prices.includes(price.id) ||
        !price.active ||
        !price.livemode ||
        price.currency !== "usd" ||
        price.recurring?.interval !== "month" ||
        price.recurring?.interval_count !== 1,
    )
  )
    throw Error("catalog_mismatch");
  const existing = configuration.features.subscription_update;
  const products = (existing.products ?? []).map((product) => ({
    ...product,
    prices: [...product.prices],
  }));
  for (const price of catalog) {
    const id = typeof price.product === "string" ? price.product : price.product.id;
    const product = products.find((entry) => entry.product === id);
    if (product) {
      if (!product.prices.includes(price.id)) product.prices.push(price.id);
    } else products.push({ product: id, prices: [price.id] });
  }
  return {
    features: {
      subscription_update: {
        default_allowed_updates: [
          ...new Set([...(existing.default_allowed_updates ?? []), "price"]),
        ],
        products,
      },
    },
  };
}
export function portalPlanChangesReady(configuration, catalog) {
  try {
    portalPlanChange(configuration, catalog);
  } catch {
    return false;
  }
  const update = configuration?.features?.subscription_update;
  return !!(
    configuration?.active &&
    update?.enabled &&
    update.default_allowed_updates?.includes("price") &&
    catalog.every((price) =>
      update.products?.some(
        (product) =>
          product.product ===
            (typeof price.product === "string" ? price.product : price.product.id) &&
          product.prices.includes(price.id),
      ),
    )
  );
}
async function main() {
  const mode = process.argv[2] ?? "--review";
  if (!["--review", "--apply", "--verify"].includes(mode)) throw Error("invalid_mode");
  const id = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
  if (!/^bpc_[A-Za-z0-9]+$/.test(id ?? "")) throw Error("portal_binding_required");
  const stripe = new Stripe(process.env.STRIPE_LIVE_API_KEY, {
    apiVersion: "2026-08-26.dahlia",
    maxNetworkRetries: 0,
    timeout: 10000,
  });
  if ((await stripe.accounts.retrieve()).id !== account) throw Error("billing_account_mismatch");
  const configuration = await stripe.billingPortal.configurations.retrieve(id);
  const catalog = await Promise.all(prices.map((price) => stripe.prices.retrieve(price)));
  const patch = portalPlanChange(configuration, catalog);
  if (mode === "--apply" && !portalPlanChangesReady(configuration, catalog)) {
    await stripe.billingPortal.configurations.update(id, patch);
  }
  const result =
    mode === "--apply" ? await stripe.billingPortal.configurations.retrieve(id) : configuration;
  const ready = portalPlanChangesReady(result, catalog);
  console.log(
    JSON.stringify({
      portalPlanChangesReady: ready,
      mode,
      reviewedPrices: prices,
      patch: mode === "--review" ? patch : undefined,
    }),
  );
  if (mode === "--verify" && !ready) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename))
  main().catch(() => {
    console.error("Billing portal qualification failed; no customer payment was attempted.");
    process.exitCode = 1;
  });
