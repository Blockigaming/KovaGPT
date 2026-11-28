import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperAgentDefinitions } from "@/lib/pricing/developer-platform.server";
export const Route = createFileRoute("/api/v1/agents")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperAgentDefinitions(request),
      POST: ({ request }) => handleDeveloperAgentDefinitions(request),
      DELETE: ({ request }) => handleDeveloperAgentDefinitions(request),
    },
  },
});
