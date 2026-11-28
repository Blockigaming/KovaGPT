import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperBatches } from "@/lib/pricing/developer-batches.server";
export const Route = createFileRoute("/api/v1/response-jobs")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperBatches(request, "response"),
      POST: ({ request }) => handleDeveloperBatches(request, "response"),
    },
  },
});
