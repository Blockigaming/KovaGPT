import { createFileRoute } from "@tanstack/react-router";
import { Client } from "pg";

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
          client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: true } });
          try {
            await client.connect();
          } catch {
            throw new RehearsalError("database_connect_failed", 503);
          }
          const result = await importRehearsal(client, validated);
          processGuard.markCompleted();
          return Response.json(result, {
            headers: { "cache-control": "no-store" },
          });
        } catch (error) {
          return failure(error);
        } finally {
          await client?.end().catch(() => undefined);
        }
      },
    },
  },
});
