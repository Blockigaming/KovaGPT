export function opaqueFinanceId(namespace: string, value: string): string;
export type VerifiedFinanceEvent = { itemId: string; type: string; code: string; bodyHash: string };
export function createPlaidWebhookVerifier(
  requestPlaid: (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>,
  now?: () => number,
): (raw: string, jwt: string | null) => Promise<VerifiedFinanceEvent>;
