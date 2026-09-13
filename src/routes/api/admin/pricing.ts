import { createFileRoute } from "@tanstack/react-router";
import { handlePricingAdministration } from "@/lib/pricing/pricing-administration.server";
export const Route = createFileRoute("/api/admin/pricing")({
  server: {
    handlers: {
      GET: ({ request }) => handlePricingAdministration(request),
      POST: ({ request }) => handlePricingAdministration(request),
    },
  },
});
