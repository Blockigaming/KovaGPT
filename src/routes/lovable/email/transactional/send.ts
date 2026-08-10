import { createFileRoute } from "@tanstack/react-router";

const RETIRED_RESPONSE = {
  error: "Legacy transactional email delivery has been retired.",
  code: "legacy_email_provider_retired",
} as const;

export const Route = createFileRoute("/lovable/email/transactional/send")({
  server: {
    handlers: {
      POST: async () =>
        Response.json(RETIRED_RESPONSE, {
          status: 410,
          headers: { "Cache-Control": "no-store" },
        }),
    },
  },
});
