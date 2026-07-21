import { createFileRoute } from "@tanstack/react-router";
import { listTools } from "../lib/mcp/index";

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          name: "kovagpt-mcp",
          title: "KovaGPT",
          version: "0.1.0",
          instructions: "KovaGPT project tools. Authenticate with a Supabase user bearer token before invoking tools.",
          tools: listTools(),
        }),
    },
  },
});
