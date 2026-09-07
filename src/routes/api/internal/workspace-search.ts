import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { processWorkspaceSearchJobs } from "@/lib/workspace-search-policy.server.mjs";
import {
  embedWorkspaceText,
  workspaceEmbeddingModel,
  workspaceRpc,
  workspaceSemanticEnabled,
} from "@/lib/workspace-search.server";
const respond = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const Route = createFileRoute("/api/internal/workspace-search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = runtimeEnv("WORKSPACE_SEARCH_WORKER_SECRET")?.trim();
        if (!secret || !workspaceSemanticEnabled())
          return respond({ error: "workspace_indexing_disabled" }, 503);
        const supplied = /^Bearer\s+(.+)$/iu.exec(
          request.headers.get("authorization")?.trim() ?? "",
        )?.[1];
        if (!supplied || !timingSafeEqualText(supplied, secret))
          return respond({ error: "unauthorized" }, 401);
        if (new URL(request.url).search || request.body)
          return respond({ error: "body_and_query_not_allowed" }, 400);
        const budget = await consumeApplicationRateLimit({
          identity: "workspace_index_global",
          action: "workspace_index_daily",
          limit: 100,
          windowSeconds: 86400,
        });
        if (!budget.allowed)
          return respond(
            { error: "workspace_index_budget_unavailable" },
            budget.status === "limited" ? 429 : 503,
          );
        try {
          return respond(
            await processWorkspaceSearchJobs({
              rpc: workspaceRpc(supabaseAdmin, request.signal),
              embed: (input) => embedWorkspaceText(input, request.signal),
              model: workspaceEmbeddingModel(),
            }),
          );
        } catch {
          return respond({ error: "workspace_index_unavailable" }, 503);
        }
      },
    },
  },
});
