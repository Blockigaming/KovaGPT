import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperPrompts } from "@/lib/pricing/developer-platform.server";
export const Route = createFileRoute("/api/v1/prompts")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperPrompts(request),
      POST: ({ request }) => handleDeveloperPrompts(request),
      DELETE: ({ request }) => handleDeveloperPrompts(request),
    },
  },
});
