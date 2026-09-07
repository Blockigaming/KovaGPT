import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { z } from "zod";
import { readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { disconnectGoogle, logAudit } from "@/lib/google-oauth.server";

export const Route = createFileRoute("/api/google/disconnect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (isCrossSiteMutation(request))
          return Response.json({ error: "Cross-site request rejected" }, { status: 403 });
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        let connectionId: string, expectedRevision: number;
        try {
          ({ connectionId, expectedRevision } = z
            .object({
              connectionId: z.string().uuid(),
              expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            })
            .parse(JSON.parse(await readUtf8BodyBounded(request, 2048))));
        } catch {
          return Response.json(
            { error: "Choose the Google account to disconnect." },
            { status: 400 },
          );
        }
        try {
          await disconnectGoogle(auth.userId, connectionId, expectedRevision);
        } catch {
          return Response.json(
            { error: "Google account could not be disconnected." },
            { status: 409 },
          );
        }
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
