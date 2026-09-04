export class StripeCustomerMappingError extends Error {
  code: string;
}

export function resolveStripeCustomerId(input: {
  stripe: {
    customers: {
      create(
        values: {
          email?: string;
          metadata: { userId: string; environment: "sandbox" | "live" };
        },
        options: { idempotencyKey: string },
      ): Promise<{ id: string }>;
    };
  };
  supabase: unknown;
  environment: "sandbox" | "live";
  userId: string;
  email?: string;
}): Promise<string>;
