import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { searchWorkspace } from "@/lib/workspace-search-policy.server.mjs";
import {
  embedWorkspaceText,
  workspaceEmbeddingModel,
  workspaceRpc,
  workspaceSemanticEnabled,
} from "@/lib/workspace-search.server";

const respond = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
  });
export const Route = createFileRoute("/api/workspace/search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (isCrossSiteMutation(request))
          return respond({ error: "Cross-site requests are not allowed." }, 403);
        const caller = await requireUser(request);
        if (caller instanceof Response) return caller;
        let query: string;
        try {
          const body = JSON.parse(await readUtf8BodyBounded(request, 4096));
          if (
            typeof body?.query !== "string" ||
            body.query.trim().length < 2 ||
            body.query.length > 500
          )
            throw new Error();
          query = body.query.trim();
        } catch {
          return respond({ error: "Search with 2 to 500 characters." }, 400);
        }
        const allowance = await consumeApplicationRateLimit({
          identity: caller.userId,
          action: "workspace_search",
          limit: 30,
          windowSeconds: 60,
        });
        if (!allowance.allowed)
          return respond(
            { error: "Workspace search is temporarily unavailable. Try again shortly." },
            allowance.status === "limited" ? 429 : 503,
          );
        let semanticAllowed = false;
        if (workspaceSemanticEnabled()) {
          const userBudget = await consumeApplicationRateLimit({
            identity: caller.userId,
            action: "workspace_semantic_daily",
            limit: 60,
            windowSeconds: 86400,
          });
          if (userBudget.allowed) {
            const globalBudget = await consumeApplicationRateLimit({
              identity: "workspace_global",
              action: "workspace_semantic_global_daily",
              limit: 1000,
              windowSeconds: 86400,
            });
            semanticAllowed = globalBudget.allowed;
          }
        }
        try {
          return respond(
            await searchWorkspace({
              rpc: workspaceRpc(caller.supabaseUser, request.signal),
              embed: (input) => embedWorkspaceText(input, request.signal),
              model: workspaceEmbeddingModel(),
              query,
              semanticAllowed,
            }),
          );
        } catch {
          return respond({ error: "Workspace search could not be loaded. Please retry." }, 503);
        }
      },
    },
  },
});
