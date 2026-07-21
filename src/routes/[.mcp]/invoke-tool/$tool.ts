import { createFileRoute } from "@tanstack/react-router";
import { invokeTool } from "../../../lib/mcp/index";

export const Route = createFileRoute("/.mcp/invoke-tool/$tool")({
  server: {
    handlers: {
      POST: async ({ request, params }) => Response.json(await invokeTool(request, params.tool)),
    },
  },
});
