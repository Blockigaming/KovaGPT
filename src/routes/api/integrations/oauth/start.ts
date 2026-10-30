import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { beginOAuth } from "@/integrations/oauth-lifecycle.server";
import { OAUTH_PROVIDERS, type OAuthProviderId } from "@/integrations/oauth-providers.server";
import {
  INTEGRATION_OAUTH_COOKIE,
  publicOAuthErrorCode,
  safeOAuthLogCode,
  serializeOauthCookie,
} from "@/lib/oauth-security.server";

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
          existingAccountId?: string;
        } | null;
        if (!body?.provider || !Object.hasOwn(OAUTH_PROVIDERS, body.provider))
          return Response.json({ error: "unsupported_provider" }, { status: 400 });
        try {
          const browserNonce = crypto.randomUUID();
          const result = await beginOAuth({
            ownerId: auth.userId,
            providerId: body.provider as OAuthProviderId,
            request,
            browserNonce,
            optionalScopes: body.optionalScopes,
            returnPath: body.returnPath,
            existingAccountId: body.existingAccountId,
          });
          return Response.json(result, {
            headers: {
              "Set-Cookie": serializeOauthCookie(INTEGRATION_OAUTH_COOKIE, browserNonce),
            },
          });
        } catch (error) {
          const code = publicOAuthErrorCode(error, "oauth_start_failed");
          console.error("[oauth start]", body.provider, safeOAuthLogCode(error));
          return Response.json(
            { error: code },
            { status: code === "provider_not_configured" ? 503 : 400 },
          );
        }
      },
    },
  },
});
