import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { configuredOAuthProviders } from "@/integrations/oauth-providers.server";
import { CONNECTION_FLOWS } from "@/integrations/connection-flows.mjs";
import { verifiedConnectionReadDates } from "@/integrations/verified-reads.mjs";
import { createClient } from "@supabase/supabase-js";
export const Route = createFileRoute("/api/integrations/accounts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const db = auth.supabaseAdmin as unknown as ReturnType<typeof createClient>;
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
        // Legacy OAuth callbacks wrote last_success_at without a real API read.
        // Only successful read audit events can verify a particular service.
        let verificationAvailable = true;
        let verifiedByAccount = Object.create(null);
        if (data?.length) {
          const { data: events, error: historyError } = await db
            .from("integration_audit_events")
            .select("linked_account_id,event_type,result,safe_summary,created_at")
            .eq("owner_id", auth.userId)
            .eq("event_type", "read")
            .eq("result", "success")
            .in(
              "linked_account_id",
              data.map((account) => account.id),
            )
            .order("created_at", { ascending: false })
            .limit(1000);
          if (historyError) {
            verificationAvailable = false;
          } else {
            verifiedByAccount = verifiedConnectionReadDates(data, events, CONNECTION_FLOWS);
          }
        }
        return Response.json(
          {
            verificationAvailable,
            configuredProviders: configuredOAuthProviders().map(
              ({ id, name, requiredScopes, optionalScopes }) => ({
                id,
                name,
                requiredScopes,
                optionalScopes,
              }),
            ),
            accounts: (data ?? []).map((account) => ({
              ...account,
              verified_reads: verifiedByAccount[account.id] ?? {},
            })),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
