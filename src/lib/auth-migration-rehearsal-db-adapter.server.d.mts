import type { QueryClient } from "./auth-migration-rehearsal.server.mjs";

export const AUTH_CONSTRAINT_CATALOG_SQL: string;

export function validateAuthoritativeAuthConstraints(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>>;

export function createAuthRehearsalDatabaseAdapter(client: QueryClient): QueryClient;
