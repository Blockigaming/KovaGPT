import type Stripe from "stripe";

export declare function cancelAuthoritativeStripeSubscriptions(input: {
  stripe: Stripe;
  customerId: string;
}): Promise<{ examined: number; canceled: number }>;

export declare function retireStripeCustomerForAccountDeletion(input: {
  stripe: Stripe;
  customerId: string;
}): Promise<{
  alreadyDeleted: boolean;
  examined: number;
  canceled: number;
}>;
