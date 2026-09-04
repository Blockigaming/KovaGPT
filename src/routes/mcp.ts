import { createFileRoute } from "@tanstack/react-router";

function unavailableResponse() {
  return Response.json(
    {
      error: "external_connection_unavailable",
      message: "KovaGPT does not currently expose a remote MCP connection.",
    },
    {
      status: 501,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      GET: async () => unavailableResponse(),
      POST: async () => unavailableResponse(),
    },
  },
});
