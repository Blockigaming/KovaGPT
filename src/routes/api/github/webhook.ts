import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyGitHubWebhook } from "@/lib/github-connector.mjs";
import { processGitHubDelivery, WebhookProcessingError } from "@/lib/webhook-reliability.mjs";

const supported = new Set([
  "installation",
  "installation_repositories",
  "push",
  "issues",
  "pull_request",
  "discussion",
  "workflow_run",
  "check_suite",
  "check_run",
  "repository",
]);

export const Route = createFileRoute("/api/github/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (contentLength > 2 * 1024 * 1024) {
          return Response.json({ error: "Webhook payload too large" }, { status: 413 });
        }

        const body = await request.text();
        const signature = request.headers.get("x-hub-signature-256") ?? "";
        const delivery = request.headers.get("x-github-delivery") ?? "";
        const event = request.headers.get("x-github-event") ?? "";
        if (body.length > 2 * 1024 * 1024) {
          return Response.json({ error: "Webhook payload too large" }, { status: 413 });
        }
        if (
          !delivery ||
          !(await verifyGitHubWebhook({
            secret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
            signature,
            body,
          }))
        ) {
          return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
        }

        let payload: unknown;
        try {
          payload = JSON.parse(body);
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        try {
          const result = await processGitHubDelivery({
            supabase: supabaseAdmin,
            delivery,
            event,
            payload,
            supported,
          });
          return Response.json({ accepted: true, duplicate: result.duplicate });
        } catch (error) {
          console.error("GitHub webhook processing failed", error);
          const status = error instanceof WebhookProcessingError ? error.status : 500;
          const code =
            error instanceof WebhookProcessingError ? error.code : "github_processing_failed";
          return Response.json({ error: code }, { status });
        }
      },
    },
  },
});
