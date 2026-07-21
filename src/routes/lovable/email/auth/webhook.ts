import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server: {
    handlers: {
      POST: async () => Response.json(
        { error: 'Legacy auth-email webhook disabled. Supabase auth email templates render from KovaGPT templates directly.' },
        { status: 410 },
      ),
    },
  },
})
