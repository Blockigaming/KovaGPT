import { createFileRoute } from "@tanstack/react-router";
import { handleKovaGoogleCallback } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/google/callback")({
  server: { handlers: { GET: ({ request }) => handleKovaGoogleCallback(request) } },
});
