import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/developer/openapi")({
  server: {
    handlers: {
      GET: async () => {
        const { developerOpenApi } = await import("@/lib/developer-openapi.mjs");
        return Response.json(developerOpenApi(), {
          headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
        });
      },
    },
  },
});
