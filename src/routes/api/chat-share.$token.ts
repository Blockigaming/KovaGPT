import { createFileRoute } from "@tanstack/react-router";
import { handlePublicChatShare } from "@/lib/public-chat-share.server";
export const Route = createFileRoute("/api/chat-share/$token")({
  server: {
    handlers: { GET: ({ request, params }) => handlePublicChatShare(request, params.token) },
  },
});
