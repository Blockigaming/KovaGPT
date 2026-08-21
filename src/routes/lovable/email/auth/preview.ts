import { createFileRoute } from "@tanstack/react-router";
import { legacyLovableRouteGone } from "@/lib/legacy-lovable-route";

export const Route = createFileRoute("/lovable/email/auth/preview")({
  server: { handlers: { GET: legacyLovableRouteGone, POST: legacyLovableRouteGone } },
});
