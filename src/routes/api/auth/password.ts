import { createFileRoute } from "@tanstack/react-router";
import { handleKovaPasswordChange, handleKovaPasswordStatus } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/password")({
  server: {
    handlers: {
      GET: ({ request }) => handleKovaPasswordStatus(request),
      POST: ({ request }) => handleKovaPasswordChange(request),
    },
  },
});
