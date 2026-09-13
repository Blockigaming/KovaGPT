import { createFileRoute } from "@tanstack/react-router";
import { receiveTaskProviderEvent } from "@/lib/scheduled-task-events.server";
export const Route = createFileRoute("/api/tasks/events/$provider")({
  server: {
    handlers: { POST: ({ request, params }) => receiveTaskProviderEvent(params.provider, request) },
  },
});
