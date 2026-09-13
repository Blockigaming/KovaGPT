import type Stripe from "stripe";

export declare function stripeSubscriptionBlocksCheckout(
  subscription: Stripe.Subscription,
  nowSeconds: number,
): boolean;
