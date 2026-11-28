import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperBatches } from "@/lib/pricing/developer-batches.server";
export const Route = createFileRoute("/api/v1/batches")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperBatches(request),
      POST: ({ request }) => handleDeveloperBatches(request),
    },
  },
});
