import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { disconnectOAuth } from "@/integrations/oauth-lifecycle.server";
import { publicOAuthErrorCode, safeOAuthLogCode } from "@/lib/oauth-security.server";

export const Route = createFileRoute("/api/integrations/oauth/disconnect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const body = (await request.json().catch(() => null)) as { accountId?: string } | null;
        if (!body?.accountId)
          return Response.json({ error: "account_id_required" }, { status: 400 });
        try {
          return Response.json(await disconnectOAuth(auth.userId, body.accountId));
        } catch (error) {
          console.error("[oauth disconnect]", safeOAuthLogCode(error));
          return Response.json(
            { error: publicOAuthErrorCode(error, "disconnect_failed") },
            { status: 400 },
          );
        }
      },
    },
  },
});
