import { createFileRoute } from "@tanstack/react-router";
import { completeGitHubOAuth } from "@/lib/github-oauth.server";

export const Route = createFileRoute("/api/github/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = new URL("/apps", url.origin);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) {
          target.searchParams.set("github_error", "missing_code");
          return Response.redirect(target.toString(), 302);
        }
        try {
          await completeGitHubOAuth(code, state);
          target.searchParams.set("github_connected", "1");
        } catch {
          target.searchParams.set("github_error", "oauth_failed");
        }
        return Response.redirect(target.toString(), 302);
      },
    },
  },
});
