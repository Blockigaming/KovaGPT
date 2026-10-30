export function oauthTokenRequest(input: {
  providerId: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  code: string;
  redirectUri: string;
  verifier?: string;
}): RequestInit;
export function selectOAuthTokens(
  providerId: string,
  payload: unknown,
): { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
export function oauthRefreshRequest(input: {
  providerId: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  refreshToken: string;
}): RequestInit;
export function selectRefreshTokens(
  providerId: string,
  payload: unknown,
): ReturnType<typeof selectOAuthTokens>;
