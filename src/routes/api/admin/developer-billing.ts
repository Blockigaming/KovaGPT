import type { SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { requireAdministrator } from "@/lib/administrator.server";
export const Route = createFileRoute("/api/admin/developer-billing")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authorization = await requireAdministrator(request);
        if ("response" in authorization) return authorization.response;
        const rawPage = Number(new URL(request.url).searchParams.get("page") ?? 0);
        if (!Number.isSafeInteger(rawPage) || rawPage < 0 || rawPage > 10000)
          return Response.json(
            { error: "invalid_page" },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          );
        const db: SupabaseClient = authorization.caller.supabaseAdmin;
        const [alerts, requests] = await Promise.all([
          db
            .from("developer_billing_alerts")
            .select("id,request_id,reason,created_at,acknowledged_at")
            .is("acknowledged_at", null)
            .order("created_at", { ascending: false })
            .order("id")
            .range(rawPage * 100, rawPage * 100 + 99)
            .abortSignal(AbortSignal.timeout(10000)),
          db
            .from("developer_api_requests")
            .select(
              "id,public_model,provider,capability,settlement_state,currency,maximum_reserved_charge,final_customer_charge,final_upstream_cost,total_variable_cost,gross_profit,gross_margin_percentage,below_margin_floor,created_at",
            )
            .in("settlement_state", ["uncertain", "reconciliation_required"])
            .order("created_at", { ascending: false })
            .order("id")
            .range(rawPage * 100, rawPage * 100 + 99)
            .abortSignal(AbortSignal.timeout(10000)),
        ]);
        if (alerts.error || requests.error)
          return Response.json(
            { error: "billing_diagnostics_unavailable" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        return Response.json(
          { page: rawPage, pageSize: 100, alerts: alerts.data, uncertainRequests: requests.data },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
