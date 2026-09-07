import type Stripe from "stripe";
export class StripeCustomerMappingError extends Error {
  code: string;
}
export function resolveStripeCustomerId(input: {
  stripe: Stripe;
  supabase: unknown;
  environment: "sandbox" | "live";
  userId: string;
  email?: string;
}): Promise<string>;
