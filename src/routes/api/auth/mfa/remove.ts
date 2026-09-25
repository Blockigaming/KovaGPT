import { createFileRoute } from "@tanstack/react-router";
import { handleKovaMfaRemove } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/mfa/remove")({
  server: { handlers: { POST: ({ request }) => handleKovaMfaRemove(request) } },
});
