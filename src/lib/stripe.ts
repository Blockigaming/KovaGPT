import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";
import { getBillingClientConfiguration } from "@/utils/payments.functions";
import { COMPILED_PAYMENTS_CLIENT_TOKEN } from "@/lib/stripe-browser-config";

type StripeEnv = "live";

const clientToken = COMPILED_PAYMENTS_CLIENT_TOKEN;
const environment: StripeEnv = "live";

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = (async () => {
      const token = clientToken || (await getBillingClientConfiguration()).publishableKey;
      if (!token || !token.startsWith("pk_live_")) throw new Error("Live checkout is unavailable");
      const stripe = await loadStripe(token);
      if (!stripe) throw new Error("Stripe.js is unavailable");
      return stripe;
    })().catch((error) => {
      stripePromise = null;
      throw error;
    });
  }
  return stripePromise;
}

export function getStripeEnvironment(): StripeEnv {
  return environment;
}
