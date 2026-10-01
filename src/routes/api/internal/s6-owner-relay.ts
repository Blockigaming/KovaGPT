import { createFileRoute } from "@tanstack/react-router";
import { handleS6OwnerRelay } from "@/lib/s6-owner-relay.mjs";

export const Route = createFileRoute("/api/internal/s6-owner-relay")({
  server: {
    handlers: {
      GET: ({ request }) => handleS6OwnerRelay(request),
      POST: ({ request }) => handleS6OwnerRelay(request),
    },
  },
});
