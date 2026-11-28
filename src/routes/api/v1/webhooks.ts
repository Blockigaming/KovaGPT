import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperWebhooks } from "@/lib/pricing/developer-webhooks.server";
export const Route = createFileRoute("/api/v1/webhooks")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperWebhooks(request),
      POST: ({ request }) => handleDeveloperWebhooks(request),
      DELETE: ({ request }) => handleDeveloperWebhooks(request),
    },
  },
});
