import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { makeAccountLifecycleHandlers } from "@/lib/account-lifecycle-handlers.mjs";

// DELETE schedules; PATCH recovers the SAME authenticated account. Neither path
// receives cleanup/Stripe callbacks. Destruction is isolated to the due worker.
export const Route = createFileRoute("/api/account")({
  server: { handlers: makeAccountLifecycleHandlers({ authenticate: requireUser }) },
});
