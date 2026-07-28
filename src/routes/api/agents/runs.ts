import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { controlAgentRun, createAgentRun } from "@/agents/execution.server";
import type { BrowserAction } from "@/agents/policy";
export const Route = createFileRoute("/api/agents/runs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const url = new URL(request.url);
        const runId = url.searchParams.get("runId");
        let query = auth.supabaseAdmin
          .from("agent_runs" as never)
          .select(
            "id,project_id,entitlement,objective,status,current_step,attempt,max_attempts,usage,created_at,updated_at,expires_at,cancelled_at" as never,
          )
          .eq("owner_id" as never, auth.userId)
          .order("created_at" as never, { ascending: false })
          .limit(runId ? 1 : 50);
        if (runId) query = query.eq("id" as never, runId);
        const { data, error } = await query;
        if (error) return Response.json({ error: "agent_history_unavailable" }, { status: 500 });
        const ids = ((data ?? []) as unknown as { id: string }[]).map((run) => run.id);
        const { data: events } = ids.length
          ? await auth.supabaseAdmin
              .from("agent_run_events" as never)
              .select("run_id,kind,safe_payload,evidence_sha256,created_at" as never)
              .in("run_id" as never, ids)
              .order("created_at" as never, { ascending: true })
          : { data: [] };
        return Response.json({ runs: data ?? [], events: events ?? [] });
      },
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const body = (await request.json().catch(() => null)) as {
          objective?: string;
          projectId?: string;
          idempotencyKey?: string;
          actions?: BrowserAction[];
          allowedDomains?: string[];
        } | null;
        if (!body?.objective || !body.idempotencyKey || !Array.isArray(body.actions))
          return Response.json({ error: "invalid_agent_run" }, { status: 400 });
        try {
          return Response.json(
            await createAgentRun(auth, {
              objective: body.objective,
              projectId: body.projectId,
              idempotencyKey: body.idempotencyKey,
              actions: body.actions,
              allowedDomains: body.allowedDomains ?? [],
            }),
            { status: 202 },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "agent_run_failed";
          return Response.json(
            { error: message },
            { status: message === "agent_plan_required" ? 403 : 400 },
          );
        }
      },
      PATCH: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const body = (await request.json().catch(() => null)) as {
          runId?: string;
          command?: "pause" | "resume" | "cancel" | "delete" | "deny";
          approvalId?: string;
        } | null;
        if (!body?.runId || !body.command)
          return Response.json({ error: "invalid_control_request" }, { status: 400 });
        try {
          return Response.json(
            await controlAgentRun(auth, body.runId, body.command, body.approvalId),
          );
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "agent_control_failed" },
            { status: 400 },
          );
        }
      },
    },
  },
});
