import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth.server";
import { selectGoogleAccount, getGoogleAccountsHealth } from "@/lib/google-oauth.server";
import { readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { enforceGoogleRateLimit } from "@/lib/google-rate-limit.server";
export const Route = createFileRoute("/api/google/select")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (isCrossSiteMutation(request))
          return Response.json({ error: "Cross-site request rejected" }, { status: 403 });
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const limited = await enforceGoogleRateLimit(auth.userId, "select", 30);
        if (limited) return limited;
        try {
          const body = z
            .object({
              connectionId: z.string().uuid(),
              expectedRevision: z.number().int().nonnegative(),
            })
            .parse(JSON.parse(await readUtf8BodyBounded(request, 2048)));
          await selectGoogleAccount(auth.userId, body.connectionId, body.expectedRevision);
          return Response.json(await getGoogleAccountsHealth(auth.userId), {
            headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
          });
        } catch {
          return Response.json(
            { error: "Account selection changed or is unavailable. Refresh and select again." },
            { status: 409 },
          );
        }
      },
    },
  },
});
