import { createFileRoute } from "@tanstack/react-router";
import { handleKovaPasskeyList } from "@/lib/kova-auth-passkey-http.server";

export const Route = createFileRoute("/api/auth/passkeys/")({
  server: { handlers: { GET: ({ request }) => handleKovaPasskeyList(request) } },
});