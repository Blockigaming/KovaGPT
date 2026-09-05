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
const TEAM_CONTROL_ERRORS = new Set([
  "agent_run_not_found",
  "task_id_required",
  "approval_not_pending",
]);
const TEAM_CONTROL_CONFLICTS = new Set([
  "invalid_agent_state_transition",
  "agent_run_state_changed",
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
        // Team execution shares the disabled runtime. Drain without parsing so
        // no request can create an indefinitely queued legacy run. This response
        // is independent of Lockdown Mode: turning that setting off cannot make
        // an unavailable runtime executable.
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
          const clientError = TEAM_CONTROL_ERRORS.has(message);
          const conflict = TEAM_CONTROL_CONFLICTS.has(message);
          return Response.json(
            {
              error: clientError || conflict ? message : "agent_control_failed",
            },
            {
              status: conflict ? 409 : clientError ? 400 : 500,
              headers: { "Cache-Control": "no-store" },
            },
          );
        }
      },
    },
  },
});
