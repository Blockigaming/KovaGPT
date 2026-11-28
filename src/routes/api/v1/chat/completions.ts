import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperApi } from "@/lib/pricing/developer-platform.server";
export const Route = createFileRoute("/api/v1/chat/completions")({
  server: {
    handlers: { POST: async ({ request }) => handleDeveloperApi(request, "chat/completions") },
  },
});
