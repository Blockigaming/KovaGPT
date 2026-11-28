import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperRealtimeSessions } from "@/lib/pricing/developer-realtime-session.server";
export const Route = createFileRoute("/api/v1/browser-sessions")({
  server: {
    handlers: {
      POST: ({ request }) => handleDeveloperRealtimeSessions(request, "browser"),
      GET: ({ request }) => handleDeveloperRealtimeSessions(request, "browser"),
      DELETE: ({ request }) => handleDeveloperRealtimeSessions(request, "browser"),
    },
  },
});
