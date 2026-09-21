import { createFileRoute } from "@tanstack/react-router";
import { handleKovaRevokeOtherSessions } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/sessions/revoke-others")({
  server: { handlers: { POST: ({ request }) => handleKovaRevokeOtherSessions(request) } },
});
