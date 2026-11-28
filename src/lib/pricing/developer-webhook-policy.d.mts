export function webhookDestination(value: unknown, allowlist: string[]): URL;
export function publicWebhookIPv4(value: unknown): boolean;
export function parseDeveloperWebhookRequest(
  method: string,
  params: URLSearchParams,
  body: unknown,
  allowlist: string[],
): { operation: string; input: Record<string, unknown> };
export function developerWebhookSecret(master: string, endpoint: unknown): string;
export function developerWebhookSignature(
  secret: string,
  eventId: string,
  timestamp: number,
  body: string,
): string;
export function verifyDeveloperWebhook(input: {
  secret: string;
  eventId: string;
  timestamp: number;
  body: string;
  signature: string;
  now?: number;
}): boolean;
