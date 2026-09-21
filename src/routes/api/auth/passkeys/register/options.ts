import { createFileRoute } from "@tanstack/react-router";
import { handleKovaPasskeyRegisterOptions } from "@/lib/kova-auth-passkey-http.server";

export const Route = createFileRoute("/api/auth/passkeys/register/options")({
  server: { handlers: { POST: ({ request }) => handleKovaPasskeyRegisterOptions(request) } },
});