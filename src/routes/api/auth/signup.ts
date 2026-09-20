import { createFileRoute } from "@tanstack/react-router";
import { handleKovaSignup } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/signup")({
  server: { handlers: { POST: ({ request }) => handleKovaSignup(request) } },
});
