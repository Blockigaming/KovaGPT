import { createFileRoute } from "@tanstack/react-router";
import { requireUser, requireVerifiedUser } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import {
  controlWorkExecution,
  getWorkExecution,
  listWorkExecutions,
  submitWorkExecution,
  workExecutionReadiness,
} from "@/lib/work-execution.server";

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof BoundedJsonError) return json({ error: error.code }, error.status);
  const code = error instanceof Error ? error.message : "work_unavailable";
  const safe = /^work_[a-z_]+$/.test(code) ? code : "work_unavailable";
  return json(
    { error: safe },
    /conflict|stale|already_received/.test(safe)
      ? 409
      : /not_found/.test(safe)
        ? 404
        : /denied|required|lockdown/.test(safe)
          ? 403
          : /invalid|limit|too_large|too_complex/.test(safe)
            ? 400
            : 503,
  );
}
export const Route = createFileRoute("/api/work/execution")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const rate = await consumeApplicationRateLimit({
          identity: `user:${auth.userId}`,
          action: "work_execution_read",
          limit: 120,
          windowSeconds: 60,
        });
        if (!rate.allowed)
          return json({ error: "work_rate_limited" }, rate.status === "limited" ? 429 : 503);
        try {
          const url = new URL(request.url);
          const readiness = await workExecutionReadiness(auth);
          if (url.searchParams.get("readiness") === "true") return json({ readiness });
          const id = url.searchParams.get("id");
          return json(
            id
              ? { readiness, state: await getWorkExecution(auth, id) }
              : {
                  readiness,
                  ...(await listWorkExecutions(auth, url.searchParams.get("before") ?? undefined)),
                },
          );
        } catch (error) {
          return failure(error);
        }
      },
      POST: async ({ request }) => {
        if (isCrossSiteMutation(request)) return json({ error: "cross_site_request_blocked" }, 403);
        const auth = await requireVerifiedUser(request);
        if (auth instanceof Response) return auth;
        const rate = await consumeApplicationRateLimit({
          identity: `user:${auth.userId}`,
          action: "work_execution_mutation",
          limit: 30,
          windowSeconds: 60,
        });
        if (!rate.allowed)
          return json({ error: "work_rate_limited" }, rate.status === "limited" ? 429 : 503);
        if (
          request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
          "application/json"
        )
          return json({ error: "json_content_type_required" }, 415);
        try {
          const body = await readBoundedJsonObject(request, 49152);
          if (body.operation === "submit") return json(await submitWorkExecution(auth, body.input));
          if (body.operation === "control") return json(await controlWorkExecution(auth, body));
          return json({ error: "work_operation_invalid" }, 400);
        } catch (error) {
          return failure(error);
        }
      },
    },
  },
});
