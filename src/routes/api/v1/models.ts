import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperApi } from "@/lib/pricing/developer-platform.server";
export const Route = createFileRoute("/api/v1/models")({
  server: { handlers: { GET: async ({ request }) => handleDeveloperApi(request, "models") } },
});
