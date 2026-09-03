declare module "@/lib/webhook-reliability.mjs" {
  export class WebhookProcessingError extends Error {
    code: string;
    status: number;
  }

  export function processStripeEvent(input: {
    supabase: unknown;
    event: unknown;
    environment: "live" | "sandbox";
    resolvePriceId: (item: {
      price?: {
        lookup_key?: string | null;
        metadata?: { kova_plan?: string };
        id?: string;
      } | null;
    }) => string | undefined;
    retrieveSubscription: (subscriptionId: string) => Promise<unknown>;
    correlationId?: string | null;
  }): Promise<{ duplicate: boolean; applied: boolean }>;

  export function billingOutcome(type: string): string;

  export function stripeSubscriptionId(event: unknown): string | null;

  export function processGitHubDelivery(input: {
    supabase: unknown;
    delivery: string;
    event: string;
    payload: unknown;
    supported: Set<string>;
    now?: () => string;
  }): Promise<{ duplicate: boolean }>;
}
