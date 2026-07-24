<<<<<<< HEAD
import { createFileRoute } from "@tanstack/react-router";
=======
import { createFileRoute } from '@tanstack/react-router'
>>>>>>> origin/main

export const Route = createFileRoute("/lovable/email/queue/process")({
  server: {
    handlers: {
<<<<<<< HEAD
      POST: async () =>
        Response.json(
          {
            error:
              "Legacy email queue worker disabled. Configure the direct KovaGPT email provider worker instead.",
          },
          { status: 410 },
        ),
=======
      POST: async () => Response.json(
        { error: 'Legacy email queue worker disabled. Configure the direct KovaGPT email provider worker instead.' },
        { status: 410 },
      ),
>>>>>>> origin/main
    },
  },
});
