import { createFileRoute } from "@tanstack/react-router";
import { handleKovaPasskeyRegisterVerify } from "@/lib/kova-auth-passkey-http.server";

export const Route = createFileRoute("/api/auth/passkeys/register/verify")({
  server: { handlers: { POST: ({ request }) => handleKovaPasskeyRegisterVerify(request) } },
});