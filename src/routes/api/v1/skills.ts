import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperSkills } from "@/lib/pricing/developer-platform.server";
export const Route = createFileRoute("/api/v1/skills")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperSkills(request),
      POST: ({ request }) => handleDeveloperSkills(request),
      DELETE: ({ request }) => handleDeveloperSkills(request),
    },
  },
});
