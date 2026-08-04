import { createFileRoute } from "@tanstack/react-router";
import { BUILD_IDENTITY } from "@/lib/build-identity";

export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: () =>
        Response.json(BUILD_IDENTITY, {
          headers: {
            "Cache-Control": "no-store, max-age=0",
            "X-Kova-Build": BUILD_IDENTITY.sha,
            "X-Content-Type-Options": "nosniff",
          },
        }),
      HEAD: () =>
        new Response(null, {
          headers: {
            "Cache-Control": "no-store, max-age=0",
            "X-Kova-Build": BUILD_IDENTITY.sha,
          },
        }),
    },
  },
});
