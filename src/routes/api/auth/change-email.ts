import { createFileRoute } from "@tanstack/react-router";
import { handleKovaEmailChange } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/change-email")({
  server: { handlers: { POST: ({ request }) => handleKovaEmailChange(request) } },
});
