import { createFileRoute } from "@tanstack/react-router";
import { handleKovaPasskeyLoginOptions } from "@/lib/kova-auth-passkey-http.server";

export const Route = createFileRoute("/api/auth/passkeys/login/options")({
  server: { handlers: { POST: ({ request }) => handleKovaPasskeyLoginOptions(request) } },
});