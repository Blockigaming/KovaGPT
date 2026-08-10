import { createFileRoute } from "@tanstack/react-router";
import { Client } from "pg";

import { createAuthRehearsalDatabaseAdapter } from "../../../../lib/auth-migration-rehearsal-db-adapter.server.mjs";
import {
  DESTINATION_PROJECT_REF,
  RehearsalError,
  assertRehearsalDatabaseUrl,
  authenticateRequest,
  createRehearsalProcessGuard,
  importRehearsal,
  readBoundedRawJson,
  validatePayload,
} from "../../../../lib/auth-migration-rehearsal.server.mjs";
import { runtimeEnv } from "../../../../lib/runtime-env.server";

function failure(error: unknown) {
  const known = error instanceof RehearsalError;
  return Response.json(
    { status: known ? error.code : "rehearsal_failed" },
    { status: known ? error.status : 500, headers: { "cache-control": "no-store" } },
  );
}

function databaseTlsOptions(databaseCa: string | undefined) {
  return {
    rejectUnauthorized: true,
    ...(databaseCa ? { ca: databaseCa } : {}),
  };
}

function safeDatabaseCloseFailure() {
  console.error(
    `[auth-migration-rehearsal] ${JSON.stringify({
      event: "auth_migration_rehearsal_failure",
      stage: "database_close",
    })}`,
  );
}

async function importWithSafeDatabaseFailure(
  database: ReturnType<typeof createAuthRehearsalDatabaseAdapter>,
  validated: Parameters<typeof importRehearsal>[1],
) {
  try {
    return await importRehearsal(database, validated);
  } catch (error) {
    if (error instanceof RehearsalError) throw error;
    throw new RehearsalError("database_operation_failed", 503);
  }
}

const processGuard = createRehearsalProcessGuard();

export const Route = createFileRoute("/api/internal/auth-migration/rehearsal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let client: Client | undefined;
        try {
          if (runtimeEnv("AUTH_MIGRATION_REHEARSAL_ENABLED") !== "true")
            throw new RehearsalError("disabled", 404);
          processGuard.assertAvailable();
          const sourceId = runtimeEnv("AUTH_MIGRATION_SOURCE_ID");
          const destination = runtimeEnv("AUTH_MIGRATION_DESTINATION_PROJECT_REF");
          const databaseUrl = runtimeEnv("AUTH_MIGRATION_REHEARSAL_DATABASE_URL");
          const databaseCa = runtimeEnv("AUTH_MIGRATION_REHEARSAL_DATABASE_CA");
          const secret = runtimeEnv("AUTH_MIGRATION_BRIDGE_SECRET");
          if (
            destination !== DESTINATION_PROJECT_REF ||
            !sourceId ||
            !databaseUrl ||
            !secret ||
            secret.length < 32
          )
            throw new RehearsalError("invalid_configuration", 503);
          assertRehearsalDatabaseUrl(databaseUrl);
          const { payload, rawBody } = await readBoundedRawJson(request);
          const auth = authenticateRequest({ headers: request.headers, rawBody, secret });
          const validated = validatePayload(payload, sourceId);
          processGuard.claimNonce(auth.nonce);
          client = new Client({
            connectionString: databaseUrl,
            connectionTimeoutMillis: 10_000,
            ssl: databaseTlsOptions(databaseCa),
          });
          try {
            await client.connect();
          } catch {
            throw new RehearsalError("database_connect_failed", 503);
          }
          const database = createAuthRehearsalDatabaseAdapter(client);
          const result = await importWithSafeDatabaseFailure(database, validated);
          processGuard.markCompleted();
          return Response.json(result, {
            headers: { "cache-control": "no-store" },
          });
        } catch (error) {
          return failure(error);
        } finally {
          await client?.end().catch(() => safeDatabaseCloseFailure());
        }
      },
    },
  },
});
