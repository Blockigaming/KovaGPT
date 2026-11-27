import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperBatches } from "@/lib/pricing/developer-batches.server";
export const Route = createFileRoute("/api/v1/automations")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperBatches(request, "automation"),
      POST: ({ request }) => handleDeveloperBatches(request, "automation"),
    },
  },
});
