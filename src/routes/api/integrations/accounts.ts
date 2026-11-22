import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import {
  configuredKeyProviders,
  configuredOAuthProviders,
} from "@/integrations/oauth-providers.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectorDatabase } from "@/integrations/connected-tools.server";
import { readBoundedJsonObject, BoundedJsonError } from "@/lib/bounded-json.server.mjs";
import { assertLockdownAllows, lockdownErrorResponse } from "@/lib/lockdown-policy.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { encryptCredential } from "@/integrations/credential-vault.server";
import { readConnection } from "@/integrations/connection-read.server.mjs";

const noStore = { "Cache-Control": "no-store" };
export const Route = createFileRoute("/api/integrations/accounts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const db = auth.supabaseAdmin as unknown as SupabaseClient<ConnectorDatabase>;
        const { data, error } = await db
          .from("integration_linked_accounts")
          .select(
            "id, provider_id, account_label, status, granted_scopes, token_expires_at, health_checked_at, last_success_at, last_error_code, created_at, updated_at",
          )
          .eq("owner_id", auth.userId)
          .is("workspace_id", null)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });
        if (error)
          return Response.json(
            { error: "accounts_unavailable" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        return Response.json(
          {
            configuredProviders: [
              ...configuredOAuthProviders().map(({ id, name, requiredScopes, optionalScopes }) => ({
                id,
                name,
                requiredScopes,
                optionalScopes,
              })),
              ...configuredKeyProviders(),
            ],
            accounts: data ?? [],
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const fail = (error: string, status: number) =>
          Response.json({ error }, { status, headers: noStore });
        try {
          if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
            return fail("expected_json", 415);
          const body = await readBoundedJsonObject(request, 1024, request.signal);
          if (typeof body.provider !== "string" || typeof body.apiKey !== "string")
            return fail("invalid_connection_credential", 400);
          const provider = configuredKeyProviders().find(
            (candidate) => candidate.id === body.provider,
          );
          if (!provider) return fail("provider_not_configured", 503);
          const apiKey = body.apiKey.trim();
          await assertLockdownAllows(auth.supabaseAdmin, auth.userId, "connector_write");
          const limit = await consumeApplicationRateLimit({
            identity: `user:${auth.userId}`,
            action: "connection_key_link",
            limit: 5,
            windowSeconds: 60,
          });
          if (!limit.allowed)
            return fail(
              limit.status === "limited"
                ? "connection_rate_limited"
                : "connection_protection_unavailable",
              limit.status === "limited" ? 429 : 503,
            );

          const db = auth.supabaseAdmin as unknown as SupabaseClient<ConnectorDatabase>;
          const providerAccountId = "personal-api-key";
          const lookup = () =>
            db
              .from("integration_linked_accounts")
              .select("id,updated_at,access_token_ciphertext")
              .eq("owner_id", auth.userId)
              .eq("provider_id", provider.id)
              .eq("provider_account_id", providerAccountId)
              .is("workspace_id", null);
          const previous = await lookup().maybeSingle();
          if (previous.error) return fail("accounts_unavailable", 503);
          await readConnection(provider.id, "recent", apiKey);
          const ciphertext = await encryptCredential(apiKey);
          if (auth.revalidateSession && !(await auth.revalidateSession()))
            return fail("connection_session_changed", 401);
          await assertLockdownAllows(auth.supabaseAdmin, auth.userId, "connector_write");
          const now = new Date().toISOString();
          const row = {
            owner_id: auth.userId,
            provider_id: provider.id,
            provider_account_id: providerAccountId,
            account_label: `${provider.name} API key`,
            status: "connected",
            granted_scopes: provider.requiredScopes,
            access_token_ciphertext: ciphertext,
            refresh_token_ciphertext: null,
            token_expires_at: null,
            health_checked_at: now,
            last_success_at: now,
            last_error_code: null,
            deleted_at: null,
            updated_at: now,
          };
          const table = db.from("integration_linked_accounts");
          const write = previous.data
            ? table
                .update(row)
                .eq("id", previous.data.id)
                .eq("owner_id", auth.userId)
                .eq("provider_id", provider.id)
                .is("workspace_id", null)
                .eq("updated_at", previous.data.updated_at)
                .eq("access_token_ciphertext", previous.data.access_token_ciphertext)
            : table.insert(row);
          const saved = await write.select("id").maybeSingle();
          if (saved.error || !saved.data) return fail("connection_changed_or_unavailable", 409);

          await db.from("integration_consents").insert({
            owner_id: auth.userId,
            linked_account_id: saved.data.id,
            scopes: provider.requiredScopes,
            purpose: `Read ${provider.name} metadata using the supplied API key`,
            decision: "granted",
          });
          await db.from("integration_audit_events").insert({
            owner_id: auth.userId,
            linked_account_id: saved.data.id,
            provider_id: provider.id,
            event_type: "connect",
            result: "success",
            safe_summary: `Connected ${provider.name} API key`,
          });
          return Response.json({ ok: true }, { headers: noStore });
        } catch (error) {
          if (error instanceof BoundedJsonError) return fail(error.code, error.status);
          const lockdown = lockdownErrorResponse(error);
          if (lockdown) return lockdown;
          const code = error instanceof Error ? error.message : "";
          if (["invalid_granola_key", "invalid_hyperframes_key"].includes(code))
            return fail("invalid_connection_credential", 400);
          if (
            ["connection_reauthorization_required", "connection_permission_required"].includes(code)
          )
            return fail("connection_credential_rejected", 403);
          if (code === "connection_rate_limited") return fail(code, 429);
          return fail("connection_setup_failed", 502);
        }
      },
    },
  },
});
