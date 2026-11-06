import type Stripe from "stripe";
export function subscriptionPortalFlow(
  stripe: Stripe,
  customerId: string,
  plan: { livePriceId: string; lookupKey: string },
  allowedProducts: string[],
): Promise<Stripe.BillingPortal.SessionCreateParams.FlowData>;
