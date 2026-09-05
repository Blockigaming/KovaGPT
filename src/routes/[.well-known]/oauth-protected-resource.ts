import { createFileRoute } from "@tanstack/react-router";
import { mcpOAuthMetadata } from "@/lib/pricing/mcp-oauth.server";
export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: { handlers: { GET: () => mcpOAuthMetadata(true) } },
});
