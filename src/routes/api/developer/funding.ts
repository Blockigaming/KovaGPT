import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperFunding } from "@/lib/pricing/developer-funding.server";
export const Route = createFileRoute("/api/developer/funding")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperFunding(request),
      POST: ({ request }) => handleDeveloperFunding(request),
    },
  },
});
