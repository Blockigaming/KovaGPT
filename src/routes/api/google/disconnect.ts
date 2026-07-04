import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { disconnectGoogle, logAudit } from "@/lib/google-oauth.server";

export const Route = createFileRoute("/api/google/disconnect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        await disconnectGoogle(auth.userId);
        await logAudit({
          userId: auth.userId,
          provider: "google",
          action: "disconnect",
          summary: "Disconnected Google account",
        });
        return Response.json({ ok: true });
      },
    },
  },
});
