import { createFileRoute } from "@tanstack/react-router";
import { administerScim } from "@/lib/scim/server";
export const Route = createFileRoute("/api/organizations/scim")({
  server: {
    handlers: {
      GET: ({ request }) => administerScim(request),
      POST: ({ request }) => administerScim(request),
    },
  },
});
