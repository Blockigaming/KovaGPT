import { createFileRoute } from "@tanstack/react-router";
import { handleMcpOAuthEndpoint } from "@/lib/pricing/mcp-oauth.server";
export const Route = createFileRoute("/oauth/mcp/$action")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleMcpOAuthEndpoint(request, params.action),
      POST: ({ request, params }) => handleMcpOAuthEndpoint(request, params.action),
      OPTIONS: ({ request, params }) => handleMcpOAuthEndpoint(request, params.action),
    },
  },
});
