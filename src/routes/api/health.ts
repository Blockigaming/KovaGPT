import { createFileRoute } from "@tanstack/react-router";
import { safeDiagnostics } from "@/lib/config/diagnostics.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(JSON.stringify(safeDiagnostics()), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
