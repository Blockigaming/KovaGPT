import { createFileRoute } from "@tanstack/react-router";
import { handleKovaMfaVerify } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/mfa/verify")({
  server: { handlers: { POST: ({ request }) => handleKovaMfaVerify(request) } },
});
