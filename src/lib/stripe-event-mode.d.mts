export type StripeEnvironment = "sandbox" | "live";

export declare function stripeEventMatchesEnvironment(
  livemode: unknown,
  environment: StripeEnvironment,
): boolean;
