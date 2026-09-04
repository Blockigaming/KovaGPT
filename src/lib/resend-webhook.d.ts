declare module "@/lib/resend-webhook.mjs" {
  export class ResendWebhookError extends Error {
    code: string;
    status: number;
  }

  export function verifyResendWebhookSignature(input: {
    secret: string | undefined;
    deliveryId: string;
    timestamp: string;
    signature: string;
    body: string;
    now?: number;
    toleranceSeconds?: number;
  }): Promise<true>;

  export function parseResendWebhookEvent(value: unknown): {
    type: string;
    providerMessageId: string;
    occurredAt: string;
  };

  export function sha256Text(value: string): Promise<string>;
}
