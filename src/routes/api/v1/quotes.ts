import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperApi } from "@/lib/pricing/developer-platform.server";
export const Route = createFileRoute("/api/v1/quotes")({
  server: { handlers: { POST: async ({ request }) => handleDeveloperApi(request, "quotes") } },
});
