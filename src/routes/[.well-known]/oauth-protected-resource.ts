import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
<<<<<<< HEAD
        const projectRef =
          process.env.SUPABASE_PROJECT_ID ??
          process.env.VITE_SUPABASE_PROJECT_ID ??
          "project-ref-unset";
=======
        const projectRef = process.env.SUPABASE_PROJECT_ID ?? process.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";
>>>>>>> origin/main
        return Response.json({
          resource: `${origin}/mcp`,
          authorization_servers: [`https://${projectRef}.supabase.co/auth/v1`],
          bearer_methods_supported: ["header"],
        });
      },
    },
  },
});
