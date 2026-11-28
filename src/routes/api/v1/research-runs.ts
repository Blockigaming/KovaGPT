import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperBatches } from "@/lib/pricing/developer-batches.server";
export const Route = createFileRoute("/api/v1/research-runs")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperBatches(request, "research"),
      POST: ({ request }) => handleDeveloperBatches(request, "research"),
    },
  },
});
