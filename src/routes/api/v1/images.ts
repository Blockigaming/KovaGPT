import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperApi } from "@/lib/pricing/developer-platform.server";
export const Route = createFileRoute("/api/v1/images")({
  server: { handlers: { POST: async ({ request }) => handleDeveloperApi(request, "images") } },
});
