import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperMcpConnections } from "@/lib/pricing/developer-mcp-connections.server";
export const Route = createFileRoute("/api/v1/mcp-connections")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperMcpConnections(request),
      POST: ({ request }) => handleDeveloperMcpConnections(request),
    },
  },
});
