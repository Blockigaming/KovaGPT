import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperApi } from "@/lib/pricing/developer-platform.server";
export const Route = createFileRoute("/api/v1/usage")({
  server: { handlers: { GET: async ({ request }) => handleDeveloperApi(request, "usage") } },
});
