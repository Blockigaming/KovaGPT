import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { configuredOAuthProviders } from "@/integrations/oauth-providers.server";
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
            "id, provider_id, account_label, status, granted_scopes, token_expires_at, health_checked_at, last_success_at, last_error_code, created_at",
          )
          .eq("owner_id", auth.userId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });
        if (error) return Response.json({ error: "accounts_unavailable" }, { status: 500 });
        return Response.json({
          configuredProviders: configuredOAuthProviders().map(
            ({ id, name, requiredScopes, optionalScopes }) => ({
              id,
              name,
              requiredScopes,
              optionalScopes,
            }),
          ),
          accounts: data ?? [],
        });
      },
    },
  },
});
