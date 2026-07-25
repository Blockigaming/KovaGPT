import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/lovable/email/queue/process")({
  server: {
    handlers: {
      POST: async () =>
        Response.json(
          {
            error:
              "Legacy email queue worker disabled. Configure the direct KovaGPT email provider worker instead.",
          },
          { status: 410 },
        ),
    },
  },
});
