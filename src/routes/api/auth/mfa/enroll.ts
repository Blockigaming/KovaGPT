import { createFileRoute } from "@tanstack/react-router";
import { handleKovaMfaEnroll } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/mfa/enroll")({
  server: { handlers: { POST: ({ request }) => handleKovaMfaEnroll(request) } },
});
