import { createFileRoute } from "@tanstack/react-router";
import { handleKovaGoogleStart } from "@/lib/kova-auth-http.server";

export const Route = createFileRoute("/api/auth/google/start")({
  server: { handlers: { GET: ({ request }) => handleKovaGoogleStart(request) } },
});
