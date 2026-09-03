import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { controlAgentRun } from "@/agents/execution.server";
import {
  AGENT_RUN_CONTROL_BODY_LIMIT_BYTES,
  AgentRequestError,
  parseAgentRunControlPayload,
  parseAgentRunQuery,
  readAgentJsonRequest,
} from "@/agents/agent-ingress.server.mjs";
import { enforceLockdownCapability } from "@/lib/lockdown-policy.mjs";

const RUN_CONTROL_ERRORS = new Set([
  "browser_agent_unavailable",
  "agent_control_unavailable",
  "agent_run_not_found",
  "active_run_cannot_be_deleted",
  "agent_run_delete_failed",
  "invalid_agent_state_transition",
  "approval_id_required",
  "approval_not_pending",
  "agent_state_changed",
  "agent_run_state_changed",
  "agent_run_not_cancellable",
]);

function agentRequestError(error: unknown, fallback: string, fallbackStatus = 400) {
  if (error instanceof AgentRequestError) {
    return Response.json(
      { error: error.publicMessage },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { error: fallback },
    { status: fallbackStatus, headers: { "Cache-Control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/agents/runs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const url = new URL(request.url);
        let runId: string | undefined;
        try {
          ({ runId } = parseAgentRunQuery(url.searchParams));
        } catch (error) {
          return agentRequestError(error, "invalid_agent_run_id");
        }
        let query = auth.supabaseAdmin
          .from("agent_runs" as never)
          .select(
            "id,project_id,status,current_step,attempt,max_attempts,usage,created_at,updated_at,expires_at,cancelled_at,agent_definition_id,agent_definition_version,tool_ids" as never,
          )
          .eq("owner_id" as never, auth.userId)
          .order("created_at" as never, { ascending: false })
          .limit(runId ? 1 : 50);
        if (runId) query = query.eq("id" as never, runId);
        const { data, error } = await query;
        if (error) return agentRequestError(null, "agent_history_unavailable", 500);
        const ids = ((data ?? []) as unknown as { id: string }[]).map((run) => run.id);
        let events: unknown[] = [];
        if (ids.length) {
          const result = await auth.supabaseAdmin
            .from("agent_run_events" as never)
            .select("run_id,kind,safe_payload,evidence_sha256,created_at" as never)
            .in("run_id" as never, ids)
            .order("created_at" as never, { ascending: true });
          if (result.error) return agentRequestError(null, "agent_history_unavailable", 500);
          events = result.data ?? [];
        }
        return Response.json(
          { runs: data ?? [], events: events ?? [] },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const lockdown = await enforceLockdownCapability(auth.supabaseAdmin, auth.userId, "agent");
        if (lockdown) return lockdown;
        // Run creation remains disabled until the worker is enabled. The versioned ingress
        // contract is nevertheless explicit so enabling it cannot bypass definition CAS.
        const expectedDefinitionVersion = request.headers.get("x-agent-definition-version");
        void expectedDefinitionVersion;
        await request.body?.cancel().catch(() => undefined);
        return Response.json(
          { error: "browser_agent_unavailable" },
          {
            status: 503,
            headers: { "Cache-Control": "no-store", "Retry-After": "3600" },
          },
        );
      },
      PATCH: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        let body: ReturnType<typeof parseAgentRunControlPayload>;
        try {
          body = parseAgentRunControlPayload(
            await readAgentJsonRequest(request, AGENT_RUN_CONTROL_BODY_LIMIT_BYTES),
          );
        } catch (error) {
          return agentRequestError(error, "invalid_control_request");
        }
        if (body.command === "resume") {
          const lockdown = await enforceLockdownCapability(
            auth.supabaseAdmin,
            auth.userId,
            "agent",
          );
          if (lockdown) return lockdown;
        }
        try {
          return Response.json(
            await controlAgentRun(auth, body.runId, body.command, body.approvalId),
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "agent_control_failed";
          const safeMessage = RUN_CONTROL_ERRORS.has(message) ? message : "agent_control_failed";
          const status =
            safeMessage === "browser_agent_unavailable" ||
            safeMessage === "agent_control_unavailable"
              ? 503
              : safeMessage === "agent_control_failed"
                ? 500
                : 400;
          return agentRequestError(null, safeMessage, status);
        }
      },
    },
  },
});
