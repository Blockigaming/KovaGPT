import { createFileRoute } from "@tanstack/react-router";
import { handleKovaRecoveryRequest } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/recovery/request")({
  server: { handlers: { POST: ({ request }) => handleKovaRecoveryRequest(request) } },
});
