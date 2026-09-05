import { createFileRoute } from "@tanstack/react-router";
import { mcpOAuthMetadata } from "@/lib/pricing/mcp-oauth.server";
export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: { handlers: { GET: () => mcpOAuthMetadata() } },
});
