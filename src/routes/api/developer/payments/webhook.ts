import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperFundingWebhook } from "@/lib/pricing/developer-funding.server";
export const Route = createFileRoute("/api/developer/payments/webhook")({
  server: { handlers: { POST: ({ request }) => handleDeveloperFundingWebhook(request) } },
});
