import { createFileRoute } from "@tanstack/react-router";
import { handleDiscovery } from "@/lib/discovery/discovery.server";
export const Route = createFileRoute("/api/discovery")({
  server: {
    handlers: {
      GET: ({ request }) => handleDiscovery(request),
      POST: ({ request }) => handleDiscovery(request),
    },
  },
});
