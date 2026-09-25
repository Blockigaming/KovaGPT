import { createFileRoute } from "@tanstack/react-router";
import { handleKovaMfaFactors } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/mfa/factors")({
  server: { handlers: { GET: ({ request }) => handleKovaMfaFactors(request) } },
});
