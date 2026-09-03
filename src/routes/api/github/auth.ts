import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { startGitHubOAuth } from "@/lib/github-oauth.server";
import { GITHUB_OAUTH_COOKIE, serializeOauthCookie } from "@/lib/oauth-security.server";
import { enforceLockdownCapability } from "@/lib/lockdown-policy.mjs";
export const Route = createFileRoute("/api/github/auth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const lockdown = await enforceLockdownCapability(
          auth.supabaseAdmin,
          auth.userId,
          "connector_write",
        );
        if (lockdown) return lockdown;
        try {
          const url = await startGitHubOAuth(auth.userId, new URL(request.url).origin);
          const state = new URL(url).searchParams.get("state");
          if (!state) throw new Error("GitHub OAuth state missing");
          return Response.json(
            { url },
            {
              headers: {
                "Set-Cookie": serializeOauthCookie(GITHUB_OAUTH_COOKIE, state),
              },
            },
          );
        } catch {
          return Response.json({ error: "GitHub OAuth is unavailable" }, { status: 503 });
        }
      },
    },
  },
});
