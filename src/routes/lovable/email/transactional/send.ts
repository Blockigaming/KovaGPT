import { createFileRoute } from "@tanstack/react-router";
import { legacyLovableRouteGone } from "@/lib/legacy-lovable-route";

export const Route = createFileRoute("/lovable/email/transactional/send")({
  server: { handlers: { GET: legacyLovableRouteGone, POST: legacyLovableRouteGone } },
});
