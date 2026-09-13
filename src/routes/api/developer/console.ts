import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperConsole } from "@/lib/pricing/developer-platform.server";
export const Route = createFileRoute("/api/developer/console")({
  server: {
    handlers: {
      GET: async ({ request }) => handleDeveloperConsole(request),
      POST: async ({ request }) => handleDeveloperConsole(request),
    },
  },
});
