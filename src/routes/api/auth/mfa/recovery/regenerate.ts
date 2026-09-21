import { createFileRoute } from "@tanstack/react-router";
import { handleKovaMfaRecoveryRegenerate } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/mfa/recovery/regenerate")({
  server: { handlers: { POST: ({ request }) => handleKovaMfaRecoveryRegenerate(request) } },
});
