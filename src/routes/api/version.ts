import { createFileRoute } from "@tanstack/react-router";
import { BUILD_IDENTITY } from "@/lib/build-identity";
import { requiresClientUpdate } from "@/lib/client-update-policy.server";

export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: ({ request }) =>
        Response.json(
          {
            ...BUILD_IDENTITY,
            ...(requiresClientUpdate(request.headers.get("X-Kova-Client-Build"), BUILD_IDENTITY.sha)
              ? { updateRequired: true }
              : {}),
          },
          {
            headers: {
              "Cache-Control": "no-store, max-age=0",
              "X-Kova-Build": BUILD_IDENTITY.sha,
              "X-Content-Type-Options": "nosniff",
            },
          },
        ),
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
