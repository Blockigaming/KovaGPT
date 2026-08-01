declare module "@/lib/webhook-reliability.mjs" {
  export class WebhookProcessingError extends Error {
    code: string;
    status: number;
  }

  export function processStripeEvent(input: {
    supabase: unknown;
    event: unknown;
    environment: "live" | "test";
    resolvePriceId: (item: never) => string | undefined;
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
