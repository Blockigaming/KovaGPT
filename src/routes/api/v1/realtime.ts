import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperApi } from "@/lib/pricing/developer-platform.server";
export const Route = createFileRoute("/api/v1/realtime")({
  server: { handlers: { POST: ({ request }) => handleDeveloperApi(request, "realtime") } },
});
