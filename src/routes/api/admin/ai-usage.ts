import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdministrator } from "@/lib/administrator.server";

type UsageRow = {
  user_id: string | null;
  plan_tier: string;
  kova_mode: string;
  provider_model: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  actual_cost_usd: number | null;
  estimated_cost_usd: number;
  status: string;
  latency_ms: number | null;
  error_classification: string | null;
  created_at: string;
  lease_expires_at: string | null;
};

function percentile95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

export const Route = createFileRoute("/api/admin/ai-usage")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authorization = await requireAdministrator(request);
        if ("response" in authorization) return authorization.response;
        const url = new URL(request.url);
        const page = Math.max(0, Math.min(100, Number(url.searchParams.get("page") ?? 0) || 0));
        const pageSize = 250;
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        monthStart.setUTCHours(0, 0, 0, 0);
        const db: SupabaseClient = authorization.caller.supabaseAdmin;
        const { data, error } = await db
          .from("ai_usage_events")
          .select(
            "user_id,plan_tier,kova_mode,provider_model,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,actual_cost_usd,estimated_cost_usd,status,latency_ms,error_classification,created_at,lease_expires_at",
          )
          .gte("created_at", monthStart.toISOString())
          .order("created_at", { ascending: false })
          .range(page * pageSize, page * pageSize + pageSize - 1);
        if (error)
          return Response.json(
            { error: "usage_unavailable" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        const rows = (data ?? []) as UsageRow[];
        const today = new Date().toISOString().slice(0, 10);
        const costs = (key: keyof Pick<UsageRow, "provider_model" | "kova_mode" | "plan_tier">) =>
          Object.entries(
            rows.reduce<Record<string, number>>((result, row) => {
              result[row[key]] =
                (result[row[key]] ?? 0) + Number(row.actual_cost_usd ?? row.estimated_cost_usd);
              return result;
            }, {}),
          ).map(([label, costUsd]) => ({ label, costUsd }));
        const userTotals = rows.reduce<Record<string, number>>((result, row) => {
          if (row.user_id)
            result[row.user_id] =
              (result[row.user_id] ?? 0) +
              row.input_tokens +
              row.output_tokens +
              row.reasoning_tokens;
          return result;
        }, {});
        const latencies = rows.flatMap((row) => (row.latency_ms === null ? [] : [row.latency_ms]));
        return Response.json(
          {
            page,
            pageSize,
            requestsToday: rows.filter((row) => row.created_at.startsWith(today)).length,
            requestsMonth: rows.length,
            tokens: {
              input: rows.reduce((sum, row) => sum + row.input_tokens, 0),
              cachedInput: rows.reduce((sum, row) => sum + row.cached_input_tokens, 0),
              output: rows.reduce((sum, row) => sum + row.output_tokens, 0),
              reasoning: rows.reduce((sum, row) => sum + row.reasoning_tokens, 0),
            },
            status: rows.reduce<Record<string, number>>((result, row) => {
              result[row.status] = (result[row.status] ?? 0) + 1;
              return result;
            }, {}),
            costByModel: costs("provider_model"),
            costByMode: costs("kova_mode"),
            costByPlan: costs("plan_tier"),
            highestUsageUsers: Object.entries(userTotals)
              .sort((left, right) => right[1] - left[1])
              .slice(0, 20)
              .map(([userId, tokens]) => ({ userId, tokens })),
            quotaRejections: rows.filter((row) => row.status === "quota_rejected").length,
            latency: {
              averageMs: latencies.length
                ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
                : 0,
              p95Ms: percentile95(latencies),
            },
            providerErrors: rows.reduce<Record<string, number>>((result, row) => {
              if (row.error_classification)
                result[row.error_classification] = (result[row.error_classification] ?? 0) + 1;
              return result;
            }, {}),
            staleReservations: rows.filter(
              (row) =>
                ["reserved", "started", "streaming", "stale"].includes(row.status) &&
                (!row.lease_expires_at || Date.parse(row.lease_expires_at) < Date.now()),
            ).length,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
