import { createFileRoute } from "@tanstack/react-router";
import { handleKovaPasskeyLoginVerify } from "@/lib/kova-auth-passkey-http.server";

export const Route = createFileRoute("/api/auth/passkeys/login/verify")({
  server: { handlers: { POST: ({ request }) => handleKovaPasskeyLoginVerify(request) } },
});