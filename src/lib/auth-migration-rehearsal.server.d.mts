export const DESTINATION_PROJECT_REF: "oztdrjtdglkizlewnulh";
export const FORBIDDEN_REAL_NEW_PROJECT_REF: "mfbycmbjygcfkrsuepxf";
export const MAX_BODY_BYTES: number;
export const MAX_CLOCK_SKEW_SECONDS: number;
export const NONCE_TTL_MS: number;
export const MAX_NONCES: number;
export const USER_FIELDS: string[];
export const IDENTITY_FIELDS: string[];

export class RehearsalError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status?: number);
}

export type RehearsalPayload = {
  source_id: string;
  destination_project_ref: string;
  users: Array<Record<string, unknown> & { id: string }>;
  identities: Array<
    Record<string, unknown> & {
      id: string;
      user_id: string;
      provider: "email" | "google";
      provider_id: string;
    }
  >;
};
export type ValidatedRehearsal = Pick<RehearsalPayload, "users" | "identities">;
export type QueryClient = {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rowCount?: number | null; rows: Array<Record<string, unknown>> }>;
};
export type ProcessGuard = {
  assertAvailable(): void;
  claimNonce(nonce: string, now?: number): void;
  markCompleted(): void;
  readonly completed: boolean;
};

export function signatureInput(timestamp: string, nonce: string, exactRawBody: string): string;
export function signRawBody(
  secret: string,
  timestamp: string,
  nonce: string,
  exactRawBody: string,
): string;
export function verifyRawBodySignature(
  secret: string,
  timestamp: string,
  nonce: string,
  exactRawBody: string,
  supplied: string,
): boolean;
export function assertRehearsalDatabaseUrl(databaseUrl: string): {
  kind: "direct" | "session_pooler";
};
export function validatePayload(payload: unknown, configuredSourceId: string): ValidatedRehearsal;
export function userUuidFingerprint(ids: string[]): string;
export function identityFingerprint(
  identities: Array<{ user_id: string; provider: string; provider_id: string }>,
): string;
export function readBoundedRawJson(
  request: Request,
  limit?: number,
): Promise<{ rawBody: string; payload: unknown }>;
export function authenticateRequest(input: {
  headers: Headers;
  rawBody: string;
  secret: string;
  now?: number;
}): { timestamp: number; nonce: string };
export function createRehearsalProcessGuard(options?: {
  maxNonces?: number;
  ttlMs?: number;
}): ProcessGuard;
export function preflightAuthInsertability(client: QueryClient): Promise<{
  userColumns: string[];
  identityColumns: string[];
}>;
export function importRehearsal(
  client: QueryClient,
  validated: ValidatedRehearsal,
): Promise<{
  users: number;
  identities: number;
  user_uuid_fingerprint: string;
  identity_fingerprint: string;
  provider_distribution: { email: number; google: number };
  status: "ok";
}>;
