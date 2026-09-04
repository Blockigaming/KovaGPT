import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { controlAgentTeamRun, getAgentTeamRuns } from "@/agents/team.server";
import {
  AGENT_TEAM_CONTROL_BODY_LIMIT_BYTES,
  AgentRequestError,
  parseAgentRunQuery,
  parseAgentTeamControlPayload,
  readAgentJsonRequest,
} from "@/agents/agent-ingress.server.mjs";
import { enforceLockdownCapability } from "@/lib/lockdown-policy.mjs";

 const TEAM_CONTROL_ERRORS = new Set([
  "agent_run_not_found",
  "task_id_required",
  "approval_not_pending",
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

export const Route = createFileRoute("/api/agents/teams")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        let runId: string | undefined;
        try {
          ({ runId } = parseAgentRunQuery(new URL(request.url).searchParams));
        } catch (error) {
          return agentRequestError(error, "invalid_agent_run_id");
        }
        try {
          return Response.json(await getAgentTeamRuns(auth, runId), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch {
          return agentRequestError(null, "agent_runs_unavailable", 500);
        }
      },
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const lockdown = await enforceLockdownCapability(auth.supabaseAdmin, auth.userId, "agent");
        if (lockdown) return lockdown;
        // Team execution shares the disabled runtime. Drain without parsing so
        // no request can create an indefinitely queued legacy run.
        await request.body?.cancel().catch(() => undefined);
        return Response.json(
          { error: "agent_team_execution_unavailable" },
          {
            status: 503,
            headers: { "Cache-Control": "no-store", "Retry-After": "3600" },
          },
        );
      },
      PATCH: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        let body: ReturnType<typeof parseAgentTeamControlPayload>;
        try {
          body = parseAgentTeamControlPayload(
            await readAgentJsonRequest(request, AGENT_TEAM_CONTROL_BODY_LIMIT_BYTES),
          );
        } catch (error) {
          return agentRequestError(error, "invalid_agent_control");
        }
        if (!["cancel", "deny"].includes(body.command)) {
          return Response.json(
            { error: "agent_team_execution_unavailable" },
            {
              status: 503,
              headers: { "Cache-Control": "no-store", "Retry-After": "3600" },
            },
          );
        }
        try {
          return Response.json(
            await controlAgentTeamRun(auth, body.runId, body.command, body.taskId),
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "agent_control_failed";
          return Response.json(
            {
              error: TEAM_CONTROL_ERRORS.has(message) ? message : "agent_control_failed",
            },
            {
              status: TEAM_CONTROL_ERRORS.has(message) ? 400 : 500,
              headers: { "Cache-Control": "no-store" },
            },
          );
        }
      },
    },
  },
});
