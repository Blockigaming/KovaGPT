import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          {
            error: "external_connection_unavailable",
            message: "KovaGPT does not currently expose an OAuth-protected MCP resource.",
          },
          {
            status: 404,
            headers: { "Cache-Control": "no-store" },
          },
        ),
    },
  },
});
