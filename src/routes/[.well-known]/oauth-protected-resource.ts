import { createFileRoute } from "@tanstack/react-router";

import { resolveBackendUrl } from "@/lib/backend-url";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const authorizationServer = new URL("/auth/v1", resolveBackendUrl()).toString();

        return Response.json({
          resource: `${origin}/mcp`,
          authorization_servers: [authorizationServer],
          bearer_methods_supported: ["header"],
        });
      },
    },
  },
});
