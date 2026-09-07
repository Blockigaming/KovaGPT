import type { GoogleAccountBinding } from "./google-account-policy.mjs";
export type GoogleConnection = {
  id: string;
  user_id: string;
  google_sub: string | null;
  email: string | null;
  access_token: string;
  refresh_token: string | null;
  scopes: string;
  expires_at: string;
  grant_id: string;
  credential_revision: number;
  identity_verified: boolean;
  revoked_at: string | null;
  reauthorization_required: boolean;
};
export function createGoogleAccountRuntime(input: {
  vault: (userId: string, operation: string, data: Record<string, unknown>) => Promise<unknown>;
  encrypt: (value: string) => Promise<string>;
  decrypt: (value: string) => Promise<string>;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): {
  connection: (userId: string, binding?: GoogleAccountBinding) => Promise<GoogleConnection>;
  accessToken: (userId: string, binding?: GoogleAccountBinding) => Promise<string>;
  store: (
    userId: string,
    tokens: unknown,
    attemptId: string,
  ) => Promise<{ id: string; grantId: string }>;
  disconnect: (
    userId: string,
    connectionId: string | null,
    expectedRevision?: number,
  ) => Promise<void>;
  identity: (token: string) => Promise<{ sub: string; email: string }>;
};
