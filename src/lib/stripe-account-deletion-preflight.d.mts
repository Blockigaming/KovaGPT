import type Stripe from "stripe";
export function prepareStripeAccountDeletion(options: {
  supabase: unknown;
  userId: string;
  createStripeClient: (environment: "sandbox" | "live") => Stripe;
}): Promise<Array<{ stripe: Stripe; customerId: string }>>;
