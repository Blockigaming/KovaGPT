import { createFileRoute } from "@tanstack/react-router";
import { listTools } from "../../lib/mcp/index";

export const Route = createFileRoute("/.mcp/list-tools")({
  server: {
    handlers: {
      GET: async () => Response.json({ tools: listTools() }),
      POST: async () => Response.json({ tools: listTools() }),
    },
  },
});
