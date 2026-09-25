import { createFileRoute } from "@tanstack/react-router";
import { handleKovaLogout } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/logout")({
  server: { handlers: { POST: ({ request }) => handleKovaLogout(request) } },
});
