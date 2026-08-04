import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/livez")({
  server: {
    handlers: {
      GET: () => Response.json({ status: "alive" }, { headers: { "Cache-Control": "no-store" } }),
    },
  },
});
