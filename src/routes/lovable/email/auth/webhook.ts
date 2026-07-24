<<<<<<< HEAD
import { createFileRoute } from "@tanstack/react-router";
=======
import { createFileRoute } from '@tanstack/react-router'
>>>>>>> origin/main

export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server: {
    handlers: {
<<<<<<< HEAD
      POST: async () =>
        Response.json(
          {
            error:
              "Legacy auth-email webhook disabled. Supabase auth email templates render from KovaGPT templates directly.",
          },
          { status: 410 },
        ),
=======
      POST: async () => Response.json(
        { error: 'Legacy auth-email webhook disabled. Supabase auth email templates render from KovaGPT templates directly.' },
        { status: 410 },
      ),
>>>>>>> origin/main
    },
  },
});
