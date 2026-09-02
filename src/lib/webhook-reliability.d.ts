declare module "@/lib/webhook-reliability.mjs" {
  export class WebhookProcessingError extends Error {
    code: string;
    status: number;
  }

  export function invoiceSubscriptionId(invoice: unknown): string | null;

  export function processStripeEvent(input: {
    supabase: unknown;
    event: {
      id: string;
      created: number;
      type: string;
      data: { object: unknown };
    };
    environment: "live" | "sandbox";
    resolvePriceId: (item: unknown) => string | undefined;
    retrieveSubscription: (id: string) => Promise<unknown>;
    billingOutcome?: (type: string) => string;
    correlationId?: string | null;
    now?: () => string;
  }): Promise<{ duplicate: boolean }>;

  export function processGitHubDelivery(input: {
    supabase: unknown;
    delivery: string;
    event: string;
    payload: unknown;
    supported: Set<string>;
    now?: () => string;
  }): Promise<{ duplicate: boolean }>;
}
