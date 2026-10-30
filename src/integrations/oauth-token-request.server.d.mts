export function oauthTokenRequest(input: {
  providerId: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  code: string;
  redirectUri: string;
  verifier?: string;
}): RequestInit;
