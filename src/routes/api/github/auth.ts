import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { startGitHubOAuth } from "@/lib/github-oauth.server";
export const Route = createFileRoute("/api/github/auth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        try {
          return Response.json({
            url: await startGitHubOAuth(auth.userId, new URL(request.url).origin),
          });
        } catch {
          return Response.json({ error: "GitHub OAuth is unavailable" }, { status: 503 });
        }
      },
    },
  },
});
