import { createFileRoute } from "@tanstack/react-router";
import { handleKovaPasskeyRemove } from "@/lib/kova-auth-passkey-http.server";

export const Route = createFileRoute("/api/auth/passkeys/remove")({
  server: { handlers: { POST: ({ request }) => handleKovaPasskeyRemove(request) } },
});