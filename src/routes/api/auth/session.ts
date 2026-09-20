import { createFileRoute } from "@tanstack/react-router";
import { handleKovaSession } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/session")({
  server: { handlers: { GET: ({ request }) => handleKovaSession(request) } },
});
