import { createFileRoute } from "@tanstack/react-router";
import { handleDocumentExportDelivery } from "@/lib/document-export-delivery.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";

export const Route = createFileRoute("/api/document-export")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleDocumentExportDelivery(request, { consumeRateLimit: consumeApplicationRateLimit }),
    },
  },
});
