import { createFileRoute } from "@tanstack/react-router";
import { handleMcpOAuthOwner } from "@/lib/pricing/mcp-oauth.server";
export const Route = createFileRoute("/api/developer/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => handleMcpOAuthOwner(request),
      POST: ({ request }) => handleMcpOAuthOwner(request),
    },
  },
});
