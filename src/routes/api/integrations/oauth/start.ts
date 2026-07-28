import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { beginOAuth } from "@/integrations/oauth-lifecycle.server";
import { OAUTH_PROVIDERS, type OAuthProviderId } from "@/integrations/oauth-providers.server";

export const Route = createFileRoute("/api/integrations/oauth/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const body = (await request.json().catch(() => null)) as {
          provider?: string;
          optionalScopes?: string[];
          returnPath?: string;
        } | null;
        if (!body?.provider || !(body.provider in OAUTH_PROVIDERS))
          return Response.json({ error: "unsupported_provider" }, { status: 400 });
        try {
          return Response.json(
            await beginOAuth({
              ownerId: auth.userId,
              providerId: body.provider as OAuthProviderId,
              request,
              optionalScopes: body.optionalScopes,
              returnPath: body.returnPath,
            }),
          );
        } catch (error) {
          const code = error instanceof Error ? error.message : "oauth_start_failed";
          return Response.json(
            { error: code },
            { status: code === "provider_not_configured" ? 503 : 400 },
          );
        }
      },
    },
  },
});
