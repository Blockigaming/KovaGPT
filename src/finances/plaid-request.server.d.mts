export type PlaidEnvironment = Record<string, string | undefined>;
export function financeCountry(country: unknown, env?: PlaidEnvironment): string;
export function financeLinkRequest(
  userId: string,
  country: unknown,
  env?: PlaidEnvironment,
): Record<string, unknown>;
export function plaidConfiguration(env?: PlaidEnvironment): {
  mode: "production" | "sandbox";
  base: string;
  clientId: string;
  secret: string;
};
export function requestPlaid(
  path: string,
  body: Record<string, unknown>,
  options?: {
    env?: PlaidEnvironment;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<Record<string, unknown>>;
