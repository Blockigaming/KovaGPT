import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperConversations } from "@/lib/pricing/developer-conversations.server";
export const Route = createFileRoute("/api/v1/conversations")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperConversations(request),
      POST: ({ request }) => handleDeveloperConversations(request),
      DELETE: ({ request }) => handleDeveloperConversations(request),
    },
  },
});
