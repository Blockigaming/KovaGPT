import { createFileRoute } from "@tanstack/react-router";
import { handleKovaToken } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/token")({
  server: { handlers: { GET: ({ request }) => handleKovaToken(request) } },
});
