import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperUploads } from "@/lib/pricing/developer-uploads.server";
export const Route = createFileRoute("/api/v1/uploads")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperUploads(request),
      POST: ({ request }) => handleDeveloperUploads(request),
    },
  },
});
