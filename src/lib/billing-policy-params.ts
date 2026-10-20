import type Stripe from "stripe";

/** Compile-time Stripe contract. No new trial, price mutation, proration or Portal setting. */
export function buildMonthlyIntroSessionParams(input: {
  userId: string;
  customerId: string;
  claimId: string;
  priceId: string;
  couponId: string | null;
  returnUrl: string;
  expiresAt: number;
}): Stripe.Checkout.SessionCreateParams {
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    integration_identifier: "kovagpt_checkout_wshrfyef",
    line_items: [{ price: input.priceId, quantity: 1 }],
    mode: "subscription",
    ui_mode: "embedded_page",
    return_url: input.returnUrl,
    expires_at: input.expiresAt,
    managed_payments: { enabled: true },
    customer: input.customerId,
    metadata: {
      userId: input.userId,
      kovaPolicyClaim: input.claimId,
      kovaPolicyVersion: "monthly-intro-v1",
    },
    subscription_data: { metadata: { userId: input.userId } },
    ...(input.couponId ? { discounts: [{ coupon: input.couponId }] } : {}),
  };
  return sessionParams;
}
