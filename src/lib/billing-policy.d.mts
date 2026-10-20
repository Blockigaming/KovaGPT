import type Stripe from "stripe";
export const MONTHLY_INTRO_POLICY_VERSION: "monthly-intro-v1";
export class BillingPolicyError extends Error {
  readonly code: string;
}
type Environment = "live" | "sandbox";
export function requireMonthlyIntroReadiness(supabase: unknown): Promise<void>;
export function validateMonthlyIntroPrice(
  price: Stripe.Price,
  plan: { livePriceId: string; lookupKey: string },
  environment: Environment,
): Stripe.Price;
export function validateMonthlyIntroCoupon(
  coupon: Stripe.Coupon | Stripe.DeletedCoupon,
  couponId: string,
  environment: Environment,
): Stripe.Coupon;
export function resolvePolicyCustomer(options: {
  stripe: Stripe;
  supabase: unknown;
  environment: Environment;
  userId: string;
  email?: string;
  now?: number;
}): Promise<string>;
export function createMonthlyIntroCheckout(options: {
  stripe: Stripe;
  supabase: unknown;
  environment: Environment;
  userId: string;
  email?: string;
  plan: { livePriceId: string; lookupKey: string };
  couponId: string | undefined;
  returnUrl: string;
  now?: number;
}): Promise<Stripe.Checkout.Session>;
export function reconcileMonthlyIntroCheckout(options: {
  stripe: Stripe;
  supabase: unknown;
  environment: Environment;
  userId: string;
  claimId: string;
  sessionId: string;
}): Promise<void>;
export function reconcileAccountMonthlyIntroCheckout(options: {
  stripeFactory: (environment: Environment) => Stripe;
  supabase: unknown;
  userId: string;
}): Promise<void>;
