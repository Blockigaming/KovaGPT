import { createFileRoute } from "@tanstack/react-router";
import { legacyLovableRouteGone } from "@/lib/legacy-lovable-route";

export const Route = createFileRoute("/lovable/email/suppression")({
  server: { handlers: { GET: legacyLovableRouteGone, POST: legacyLovableRouteGone } },
});
