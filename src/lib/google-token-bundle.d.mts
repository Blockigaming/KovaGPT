export const GOOGLE_TOKEN_BUNDLE_VERSION: 1;
export const GOOGLE_REFRESH_CLAIM_TTL_MS: number;

export type GoogleTokenBundle = {
  version: 1;
  userId: string;
  accessToken: string;
  refreshToken: string | null;
};

export type GoogleEncryptedTokenWrite = {
  token_ciphertext: string;
  access_token: null;
  refresh_token: null;
};

export type GoogleTokenStorageRow = {
  token_ciphertext: string | null;
  access_token: string | null;
  refresh_token: string | null;
  refresh_claim_id: string | null;
  refresh_claimed_at: string | null;
  expires_at: string;
};

export type StoredGoogleToken<TRow extends GoogleTokenStorageRow = GoogleTokenStorageRow> = {
  row: TRow;
  bundle: GoogleTokenBundle;
};

export type GoogleRefreshResponse = {
  accessToken: string;
  refreshToken?: string | null;
};

export function serializeGoogleTokenBundle(value: {
  userId: string;
  accessToken: string;
  refreshToken?: string | null;
}): string;

export function parseGoogleTokenBundle(value: string, expectedUserId: string): GoogleTokenBundle;

export function preserveGoogleRefreshToken(
  returnedRefreshToken: string | null | undefined,
  existingRefreshToken: string | null | undefined,
): string | null;

export function encryptedGoogleTokenWrite(ciphertext: string): GoogleEncryptedTokenWrite;

export function encryptGoogleTokenBundle(options: {
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  encrypt: (cleartext: string) => Promise<string>;
}): Promise<string>;

export function decryptGoogleTokenBundle(options: {
  userId: string;
  ciphertext: string;
  decrypt: (ciphertext: string) => Promise<string>;
}): Promise<GoogleTokenBundle>;

export function loadGoogleTokenCredential<TRow extends GoogleTokenStorageRow>(options: {
  userId: string;
  row: TRow | null;
  encrypt: (cleartext: string) => Promise<string>;
  decrypt: (ciphertext: string) => Promise<string>;
  migrateLegacy: (write: GoogleEncryptedTokenWrite) => Promise<TRow | null>;
  refetch: () => Promise<TRow | null>;
}): Promise<StoredGoogleToken<TRow> | null>;

export function storeGoogleTokenCredential<TRow extends GoogleTokenStorageRow>(options: {
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  encrypt: (cleartext: string) => Promise<string>;
  decrypt: (ciphertext: string) => Promise<string>;
  upsert: (write: GoogleEncryptedTokenWrite) => Promise<TRow | null>;
}): Promise<string>;

export function disconnectGoogleTokenCredential<TRow extends GoogleTokenStorageRow>(options: {
  load: () => Promise<StoredGoogleToken<TRow> | null>;
  deleteRow: (row: TRow) => Promise<boolean>;
  revoke: (token: string) => Promise<unknown>;
}): Promise<boolean>;

export function refreshGoogleTokenCredential<
  TRow extends GoogleTokenStorageRow,
  TResponse extends GoogleRefreshResponse,
>(options: {
  userId: string;
  load: () => Promise<StoredGoogleToken<TRow> | null>;
  claimRefresh: (row: TRow, claim: { id: string; at: string }) => Promise<TRow | null>;
  refetch: () => Promise<TRow | null>;
  releaseRefresh: (row: TRow, claim: { id: string; at: string }) => Promise<unknown>;
  providerRefresh: (refreshToken: string) => Promise<TResponse>;
  completeRefresh: (options: {
    claimedRow: TRow;
    claim: { id: string; at: string };
    response: TResponse;
    write: GoogleEncryptedTokenWrite;
  }) => Promise<TRow | null>;
  encrypt: (cleartext: string) => Promise<string>;
  decrypt: (ciphertext: string) => Promise<string>;
  now?: () => number;
  createClaimId?: () => string;
}): Promise<string>;

export function runAfterGoogleTokenStorageReady<TPrepared, TResult>(
  prepareStorage: () => Promise<TPrepared>,
  providerOperation: (prepared: TPrepared) => Promise<TResult>,
): Promise<TResult>;
