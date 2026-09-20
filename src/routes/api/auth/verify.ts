import { createFileRoute } from "@tanstack/react-router";
import { handleKovaVerification } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/verify")({
  server: { handlers: { GET: ({ request }) => handleKovaVerification(request) } },
});
