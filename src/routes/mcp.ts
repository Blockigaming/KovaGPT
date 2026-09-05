import { mcpOAuthPreflight } from "@/lib/pricing/mcp-oauth.server";
import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperMcp } from "@/lib/pricing/developer-mcp.server";

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      OPTIONS: () => mcpOAuthPreflight(),
      GET: async ({ request }) => handleDeveloperMcp(request),
      POST: async ({ request }) => handleDeveloperMcp(request),
    },
  },
});
