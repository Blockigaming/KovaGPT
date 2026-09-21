import { createFileRoute } from "@tanstack/react-router";
import { handleKovaPasskeyRename } from "@/lib/kova-auth-passkey-http.server";

export const Route = createFileRoute("/api/auth/passkeys/rename")({
  server: { handlers: { POST: ({ request }) => handleKovaPasskeyRename(request) } },
});