import { createFileRoute } from "@tanstack/react-router";
import { handleKovaGoogleExchange } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/google/exchange")({
  server: { handlers: { GET: ({ request }) => handleKovaGoogleExchange(request) } },
});
