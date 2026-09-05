import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperFiles } from "@/lib/pricing/developer-files.server";
export const Route = createFileRoute("/api/v1/files")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperFiles(request),
      POST: ({ request }) => handleDeveloperFiles(request),
      DELETE: ({ request }) => handleDeveloperFiles(request),
    },
  },
});
