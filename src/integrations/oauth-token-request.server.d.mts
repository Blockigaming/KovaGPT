export function oauthTokenRequest(input: {
  providerId: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  code: string;
  redirectUri: string;
  verifier?: string;
  tokenClientAuth?: "client_secret_post" | "client_secret_basic" | "none";
}): RequestInit;
export function selectOAuthTokens(
  providerId: string,
  payload: unknown,
): {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  provider_account_id?: string;
};
export function oauthRefreshRequest(input: {
  providerId: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  refreshToken: string;
  tokenClientAuth?: "client_secret_post" | "client_secret_basic" | "none";
}): RequestInit;
export function selectRefreshTokens(
  providerId: string,
  payload: unknown,
): ReturnType<typeof selectOAuthTokens>;
export function tanaRevocationRequest(input: {
  clientId: string | undefined;
  clientSecret: string | undefined;
  tokenClientAuth?: "client_secret_post" | "client_secret_basic" | "none";
  token: string;
}): RequestInit;
