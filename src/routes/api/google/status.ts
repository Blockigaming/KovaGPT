import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { getGoogleConnection } from "@/lib/google-oauth.server";

export const Route = createFileRoute("/api/google/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const conn = await getGoogleConnection(auth.userId);
        if (!conn) return Response.json({ connected: false });
        const scopes = (conn.scopes ?? "").split(/\s+/).filter(Boolean);
        return Response.json({
          connected: true,
          email: conn.email,
          scopes,
          has: {
            gmail: scopes.some((s) => s.includes("gmail")),
            calendar: scopes.some((s) => s.includes("calendar")),
            drive: scopes.some((s) => s.includes("drive")),
          },
        });
      },
    },
  },
});
