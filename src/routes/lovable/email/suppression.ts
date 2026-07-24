<<<<<<< HEAD
import { createFileRoute } from "@tanstack/react-router";
=======
import { createFileRoute } from '@tanstack/react-router'
>>>>>>> origin/main

export const Route = createFileRoute("/lovable/email/suppression")({
  server: {
    handlers: {
<<<<<<< HEAD
      POST: async () =>
        Response.json(
          {
            error:
              "Legacy suppression webhook disabled. Use the configured direct email-provider webhook endpoint.",
          },
          { status: 410 },
        ),
=======
      POST: async () => Response.json(
        { error: 'Legacy suppression webhook disabled. Use the configured direct email-provider webhook endpoint.' },
        { status: 410 },
      ),
>>>>>>> origin/main
    },
  },
});
