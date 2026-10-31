import { createFileRoute } from "@tanstack/react-router";
import { handleShareManagement } from "@/lib/public-chat-share.server";
export const Route = createFileRoute("/api/chat-share")({
  server: {
    handlers: {
      GET: ({ request }) => handleShareManagement(request),
      POST: ({ request }) => handleShareManagement(request),
      DELETE: ({ request }) => handleShareManagement(request),
    },
  },
});
