import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";
import { PUBLIC_PAYMENTS_CLIENT_TOKEN } from "@/config/public-config";

type StripeEnv = "live";

const clientToken =
  (import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined) ||
  PUBLIC_PAYMENTS_CLIENT_TOKEN;
const environment: StripeEnv = "live";

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    if (!clientToken) throw new Error("VITE_PAYMENTS_CLIENT_TOKEN is not set");
    if (!clientToken.startsWith("pk_live_")) {
      throw new Error("Live billing requires a Stripe pk_live publishable key");
    }
    stripePromise = loadStripe(clientToken);
  }
  return stripePromise;
}

export function getStripeEnvironment(): StripeEnv {
  return environment;
}
