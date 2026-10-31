export const SALESFORCE_PROFILE_ENDPOINT: string;
export type SalesforceCredential = {
  version: 1;
  access_token: string;
  query_url: string;
  organization_id: string;
  user_id: string;
};
export function salesforceQueryUrl(value: unknown): URL;
export function packSalesforceCredential(
  accessToken: string,
  profile: Record<string, unknown>,
): string;
export function unpackSalesforceCredential(packed: string): SalesforceCredential;
export function salesforceOAuthEndpoint(packed: string, operation: "token" | "revoke"): string;
export function renewSalesforceCredential(
  packed: string,
  accessToken: string,
  ensureCurrent: () => Promise<void>,
  fetchImpl?: typeof fetch,
): Promise<string>;
