import { createFileRoute } from "@tanstack/react-router";
import { handleKovaVerificationResend } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/verify/resend")({
  server: { handlers: { POST: ({ request }) => handleKovaVerificationResend(request) } },
});
