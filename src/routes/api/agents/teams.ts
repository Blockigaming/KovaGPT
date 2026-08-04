import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { controlAgentTeamRun, getAgentTeamRuns } from "@/agents/team.server";
import type { AgentTaskInput } from "@/agents/team";
export const Route = createFileRoute("/api/agents/teams")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        try {
          return Response.json(
            await getAgentTeamRuns(
              auth,
              new URL(request.url).searchParams.get("runId") ?? undefined,
            ),
          );
        } catch {
          return Response.json({ error: "agent_runs_unavailable" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const body = (await request.json().catch(() => null)) as {
          objective?: string;
          projectId?: string;
          idempotencyKey?: string;
          tasks?: AgentTaskInput[];
          context?: string[];
        } | null;
        if (!body?.objective || !body.idempotencyKey || !Array.isArray(body.tasks))
          return Response.json({ error: "invalid_agent_team" }, { status: 400 });
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
        const body = (await request.json().catch(() => null)) as {
          runId?: string;
          command?: "pause" | "resume" | "cancel" | "retry" | "approve" | "deny";
          taskId?: string;
        } | null;
        if (!body?.runId || !body.command)
          return Response.json({ error: "invalid_agent_control" }, { status: 400 });
        try {
          return Response.json(
            await controlAgentTeamRun(auth, body.runId, body.command, body.taskId),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "agent_control_failed";
          return Response.json(
            { error: message },
            { status: message === "browser_agent_unavailable" ? 503 : 400 },
          );
        }
      },
    },
  },
});
