import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperFiles } from "@/lib/pricing/developer-files.server";
export const Route = createFileRoute("/api/developer/files")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperFiles(request, true),
      DELETE: ({ request }) => handleDeveloperFiles(request, true),
    },
  },
});
