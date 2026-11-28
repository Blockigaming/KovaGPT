import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperRealtimeSessions } from "@/lib/pricing/developer-realtime-session.server";
export const Route = createFileRoute("/api/v1/realtime-sessions")({
  server: {
    handlers: {
      POST: ({ request }) => handleDeveloperRealtimeSessions(request),
      GET: ({ request }) => handleDeveloperRealtimeSessions(request),
      DELETE: ({ request }) => handleDeveloperRealtimeSessions(request),
    },
  },
});
