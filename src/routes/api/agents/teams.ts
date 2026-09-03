import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { controlAgentTeamRun, createAgentTeamRun, getAgentTeamRuns } from "@/agents/team.server";
import { validateTaskGraph } from "@/agents/team";
import {
  AGENT_TEAM_CONTROL_BODY_LIMIT_BYTES,
  AGENT_TEAM_CREATE_BODY_LIMIT_BYTES,
  AgentRequestError,
  authorizeAgentProject,
  parseAgentRunQuery,
  parseAgentTeamControlPayload,
  parseAgentTeamCreatePayload,
  readAgentJsonRequest,
  type AgentProjectAuthorizationClient,
} from "@/agents/agent-ingress.server.mjs";
import { enforceLockdownCapability } from "@/lib/lockdown-policy.mjs";

const TEAM_CREATE_ERRORS = new Set([
  "agent_plan_required",
  "agent_team_limit",
  "invalid_objective",
  "agent_team_create_failed",
  "agent_tasks_store_failed",
]);
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
        let body: ReturnType<typeof parseAgentTeamCreatePayload>;
        try {
          body = parseAgentTeamCreatePayload(
            await readAgentJsonRequest(request, AGENT_TEAM_CREATE_BODY_LIMIT_BYTES),
          );
          if (validateTaskGraph(body.tasks).length) {
            throw new AgentRequestError("invalid_agent_graph", 400);
          }
          body.projectId = await authorizeAgentProject({
            supabaseUser: auth.supabaseUser as unknown as AgentProjectAuthorizationClient,
            projectId: body.projectId,
          });
        } catch (error) {
          return agentRequestError(error, "invalid_agent_team");
        }
        try {
          return Response.json(
            await createAgentTeamRun(auth, {
              objective: body.objective,
              projectId: body.projectId,
              idempotencyKey: body.idempotencyKey,
              tasks: body.tasks,
              context: body.context ?? [],
            }),
            { status: 202, headers: { "Cache-Control": "no-store" } },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "agent_team_failed";
          const safeMessage = TEAM_CREATE_ERRORS.has(message) ? message : "agent_team_failed";
          const status =
            safeMessage === "agent_plan_required"
              ? 403
              : safeMessage === "agent_team_create_failed" ||
                  safeMessage === "agent_tasks_store_failed"
                ? 503
                : safeMessage === "agent_team_failed"
                  ? 500
                  : 400;
          return agentRequestError(null, safeMessage, status);
        }
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
        if (["resume", "retry", "approve"].includes(body.command)) {
          const lockdown = await enforceLockdownCapability(
            auth.supabaseAdmin,
            auth.userId,
            "agent",
          );
          if (lockdown) return lockdown;
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
