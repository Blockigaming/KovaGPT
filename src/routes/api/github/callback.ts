import { createFileRoute } from "@tanstack/react-router";
import { completeGitHubOAuth } from "@/lib/github-oauth.server";
import {
  GITHUB_OAUTH_COOKIE,
  readOauthCookie,
  redirectClearingOauthCookie,
} from "@/lib/oauth-security.server";

export const Route = createFileRoute("/api/github/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = new URL("/apps", url.origin);
        const redirect = () => redirectClearingOauthCookie(target, GITHUB_OAUTH_COOKIE);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) {
          target.searchParams.set("github_error", "missing_code");
          return redirect();
        }
        const browserState = readOauthCookie(request, GITHUB_OAUTH_COOKIE);
        if (!browserState || browserState !== state) {
          target.searchParams.set("github_error", "invalid_state");
          return redirect();
        }
        try {
          await completeGitHubOAuth(code, state, browserState);
          target.searchParams.set("github_connected", "1");
        } catch {
          target.searchParams.set("github_error", "oauth_failed");
        }
        return redirect();
      },
    },
  },
});
