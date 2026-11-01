import { createFileRoute } from "@tanstack/react-router";
const retired = () =>
  Response.json(
    { error: "This feature has been retired. Use chat search instead." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
export const Route = createFileRoute("/api/discovery")({
  server: { handlers: { GET: retired, POST: retired } },
});
