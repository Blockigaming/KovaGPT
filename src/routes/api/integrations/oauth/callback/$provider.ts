import { createFileRoute } from "@tanstack/react-router";
import { completeOAuth } from "@/integrations/oauth-lifecycle.server";
import { OAUTH_PROVIDERS, type OAuthProviderId } from "@/integrations/oauth-providers.server";

export const Route = createFileRoute("/api/integrations/oauth/callback/$provider")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const provider = params.provider;
        const target = new URL("/apps", url.origin);
        if (!(provider in OAUTH_PROVIDERS)) {
          target.searchParams.set("integration_error", "unsupported_provider");
          return Response.redirect(target, 302);
        }
        const code = url.searchParams.get("code"),
          state = url.searchParams.get("state"),
          providerError = url.searchParams.get("error");
        if (providerError || !code || !state) {
          target.searchParams.set(
            "integration_error",
            providerError ?? "missing_callback_parameters",
          );
          return Response.redirect(target, 302);
        }
        try {
          const result = await completeOAuth({
            providerId: provider as OAuthProviderId,
            code,
            state,
            request,
          });
          const safe = new URL(result.returnPath, url.origin);
          safe.searchParams.set("integration_connected", provider);
          return Response.redirect(safe, 302);
        } catch (error) {
          console.error(
            "[oauth callback]",
            provider,
            error instanceof Error ? error.message : "failure",
          );
          target.searchParams.set("integration_error", "connection_failed");
          return Response.redirect(target, 302);
        }
      },
    },
  },
});
