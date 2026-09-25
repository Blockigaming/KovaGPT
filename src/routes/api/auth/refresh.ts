import { createFileRoute } from "@tanstack/react-router";
import { handleKovaRefresh } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/refresh")({
  server: { handlers: { POST: ({ request }) => handleKovaRefresh(request) } },
});
