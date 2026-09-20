import { createFileRoute } from "@tanstack/react-router";
import { handleKovaRecoveryReset } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/recovery/reset")({
  server: { handlers: { POST: ({ request }) => handleKovaRecoveryReset(request) } },
});
