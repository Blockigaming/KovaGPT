import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/lovable/email/suppression")({
  server: {
    handlers: {
      POST: async () =>
        Response.json(
          {
            error:
              "Legacy suppression webhook disabled. Use the configured direct email-provider webhook endpoint.",
          },
          { status: 410 },
        ),
    },
  },
});
