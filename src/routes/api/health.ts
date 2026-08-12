import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          {
            ok: true,
            app: "KovaGPT",
            status: "ok",
            service: "kovagpt-web",
            environment: process.env.AZURE_ENVIRONMENT || process.env.NODE_ENV || "development",
            timestamp: new Date().toISOString(),
          },
          {
            headers: {
              "Cache-Control": "no-store",
            },
          },
        ),
    },
  },
});
