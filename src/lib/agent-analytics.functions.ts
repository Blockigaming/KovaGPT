import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Run = {
  id: string;
  status: string;
  agent_definition_version: number | null;
  project_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  failure_category: string | null;
  tool_call_count: number;
  tool_ids: string[];
  retry_count: number;
  provider_id: string | null;
  model_id: string | null;
};
export type AgentAnalytics = {
  rangeDays: 7 | 30 | 90;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  active: number;
  completionRate: number | null;
  averageRuntimeSeconds: number | null;
  medianRuntimeSeconds: number | null;
  p90RuntimeSeconds: number | null;
  retries: number;
  statuses: Record<string, number>;
  tools: Record<string, number>;
  versions: Record<string, number>;
  failures: Record<string, number>;
  projects: Record<string, number>;
  providers: Record<string, number>;
  models: Record<string, number>;
  recent: Run[];
  lastExecution: string | null;
  lastSuccess: string | null;
};
type Query = PromiseLike<{ data: Run[] | null; error: unknown }> & {
  select: (columns: string) => Query;
  eq: (column: string, value: unknown) => Query;
  gte: (column: string, value: string) => Query;
  order: (column: string, options: unknown) => Query;
  limit: (count: number) => Query;
};
const increment = (map: Record<string, number>, key: string | null | undefined) => {
  if (key) map[key] = (map[key] ?? 0) + 1;
};
const percentile = (values: number[], ratio: number) =>
  values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)] : null;

export const getAgentAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<AgentAnalytics> => {
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const query = (context.supabase as unknown as { from: (name: string) => Query }).from(
      "agent_runs",
    );
    const result = await query
      .select(
        "id,status,agent_definition_version,project_id,started_at,completed_at,created_at,updated_at,failure_category,tool_call_count,tool_ids,retry_count,provider_id,model_id",
      )
      .eq("owner_id", context.userId)
      .eq("agent_definition_id", data.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (result.error) throw new Error("Agent analytics could not be loaded.");
    const runs = result.data ?? [],
      statuses: Record<string, number> = {},
      tools: Record<string, number> = {},
      versions: Record<string, number> = {},
      failures: Record<string, number> = {},
      projects: Record<string, number> = {},
      providers: Record<string, number> = {},
      models: Record<string, number> = {};
    const runtimes: number[] = [];
    for (const run of runs) {
      increment(statuses, run.status);
      increment(versions, run.agent_definition_version?.toString());
      increment(failures, run.failure_category);
      increment(projects, run.project_id ?? "No project");
      increment(providers, run.provider_id);
      increment(models, run.model_id);
      for (const tool of run.tool_ids ?? []) increment(tools, tool);
      if (run.status === "completed") {
        const start = Date.parse(run.started_at ?? run.created_at),
          end = Date.parse(run.completed_at ?? run.updated_at);
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start)
          runtimes.push(Math.round((end - start) / 1000));
      }
    }
    runtimes.sort((a, b) => a - b);
    const completed = statuses.completed ?? 0;
    return {
      rangeDays: data.days,
      total: runs.length,
      completed,
      failed: statuses.failed ?? 0,
      cancelled: statuses.cancelled ?? 0,
      active: [
        "queued",
        "leased",
        "planning",
        "running",
        "approval_needed",
        "paused",
        "retry_wait",
      ].reduce((sum, key) => sum + (statuses[key] ?? 0), 0),
      completionRate: runs.length >= 5 ? Math.round((completed / runs.length) * 1000) / 10 : null,
      averageRuntimeSeconds: runtimes.length
        ? Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length)
        : null,
      medianRuntimeSeconds: percentile(runtimes, 0.5),
      p90RuntimeSeconds: runtimes.length >= 10 ? percentile(runtimes, 0.9) : null,
      retries: runs.reduce((sum, run) => sum + (run.retry_count ?? 0), 0),
      statuses,
      tools,
      versions,
      failures,
      projects,
      providers,
      models,
      recent: runs.slice(0, 50),
      lastExecution: runs[0]?.created_at ?? null,
      lastSuccess: runs.find((run) => run.status === "completed")?.completed_at ?? null,
    };
  });
