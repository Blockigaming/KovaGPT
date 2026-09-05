export const MCP_OAUTH_SCOPES: readonly string[];
export const MCP_OAUTH_SCOPE_LABELS: Readonly<Record<string, string>>;
export function mcpUuid(value: unknown): string;
export function mcpIssuer(value: unknown): string;
export function mcpScopes(value: unknown, allowed?: readonly string[]): string[];
export function mcpRedirect(value: unknown, applicationType?: string): string;
export function mcpClientRegistration(value: unknown): Record<string, unknown>;
export function mcpAuthorizationRequest(
  params: URLSearchParams,
  issuer: string,
): {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  challenge: string;
  resource: string;
};
export function mcpVerifier(value: unknown): string;
export function mcpCanonical(value: unknown): string;
export function mcpReviewPayload(
  request: { id: string; requestHash: string; scopes: string[] },
  projectId: unknown,
  scopes: unknown,
  limits: unknown,
): {
  requestId: string;
  requestHash: string;
  projectId: string;
  scopes: string[];
  limits: { request: number; daily: number; monthly: number; concurrent: number };
};
