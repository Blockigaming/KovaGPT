import { createFileRoute } from "@tanstack/react-router";
import { handleKovaLogin } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/login")({
  server: { handlers: { POST: ({ request }) => handleKovaLogin(request) } },
});
