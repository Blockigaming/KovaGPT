import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { verifyCreditOfferPrice } from "./pricing-administration.mjs";

/** Read-only validation immediately before approval or opening Checkout. */
export async function verifyConfiguredCreditOffer(proposal: Record<string, unknown>) {
  if (!["sandbox", "live"].includes(String(proposal.environment)))
    throw new Error("pricing_admin_credit_offer_invalid");
  const stripe = createStripeClient(proposal.environment as StripeEnv);
  const options = { timeout: 10000, maxNetworkRetries: 0 };
  const [price, account] = await Promise.all([
    stripe.prices.retrieve(String(proposal.stripe_price_id), { expand: ["product"] }, options),
    stripe.accounts.retrieve(null, {}, options),
  ]);
  const [registrations, settings] =
    proposal.tax_mode === "automatic"
      ? await Promise.all([
          stripe.tax.registrations.list({ status: "active", limit: 1 }, options),
          stripe.tax.settings.retrieve({}, options),
        ])
      : [null, null];
  verifyCreditOfferPrice(proposal, price, registrations?.data ?? [], settings, account);
}
