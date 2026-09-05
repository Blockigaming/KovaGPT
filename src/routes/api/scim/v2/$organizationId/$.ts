import { createFileRoute } from "@tanstack/react-router";
import { receiveScim } from "@/lib/scim/server";
export const Route = createFileRoute("/api/scim/v2/$organizationId/$")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        receiveScim(request, params.organizationId, params._splat ?? ""),
      POST: ({ request, params }) =>
        receiveScim(request, params.organizationId, params._splat ?? ""),
      PUT: ({ request, params }) =>
        receiveScim(request, params.organizationId, params._splat ?? ""),
      PATCH: ({ request, params }) =>
        receiveScim(request, params.organizationId, params._splat ?? ""),
      DELETE: ({ request, params }) =>
        receiveScim(request, params.organizationId, params._splat ?? ""),
    },
  },
});
