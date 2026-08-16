import { createFileRoute } from "@tanstack/react-router";
import { completeOAuth } from "@/integrations/oauth-lifecycle.server";
import { OAUTH_PROVIDERS, type OAuthProviderId } from "@/integrations/oauth-providers.server";
import {
  INTEGRATION_OAUTH_COOKIE,
  normalizeOAuthReturnPath,
  readOauthCookie,
  redirectClearingOauthCookie,
  safeOAuthLogCode,
} from "@/lib/oauth-security.server";

export const Route = createFileRoute("/api/integrations/oauth/callback/$provider")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const provider = params.provider;
        const target = new URL("/apps", url.origin);
        const redirect = (location: URL) =>
          redirectClearingOauthCookie(location, INTEGRATION_OAUTH_COOKIE);
        if (!(provider in OAUTH_PROVIDERS)) {
          target.searchParams.set("integration_error", "unsupported_provider");
          return redirect(target);
        }
        const code = url.searchParams.get("code"),
          state = url.searchParams.get("state"),
          providerError = url.searchParams.get("error");
        if (providerError || !code || !state) {
          target.searchParams.set(
            "integration_error",
            providerError ? "provider_denied" : "missing_callback_parameters",
          );
          return redirect(target);
        }
        const browserNonce = readOauthCookie(request, INTEGRATION_OAUTH_COOKIE);
        if (!browserNonce) {
          target.searchParams.set("integration_error", "invalid_state");
          return redirect(target);
        }
        try {
          const result = await completeOAuth({
            providerId: provider as OAuthProviderId,
            code,
            state,
            request,
            browserNonce,
          });
          const safe = new URL(normalizeOAuthReturnPath(result.returnPath), url.origin);
          safe.searchParams.set("integration_connected", provider);
          return redirect(safe);
        } catch (error) {
          console.error("[oauth callback]", provider, safeOAuthLogCode(error));
          target.searchParams.set("integration_error", "connection_failed");
          return redirect(target);
        }
      },
    },
  },
});
