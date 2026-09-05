import type Stripe from "stripe";
export class StripeCheckoutPendingError extends Error {}
export function resolveDurableCheckoutSession(options: {
  stripe: Stripe;
  supabase: unknown;
  userId: string;
  environment: "live" | "sandbox";
  attempt: Record<string, unknown>;
  params: Stripe.Checkout.SessionCreateParams;
}): Promise<Stripe.Checkout.Session>;
