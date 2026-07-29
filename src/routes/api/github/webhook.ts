import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyGitHubWebhook } from "@/lib/github-connector.mjs";
/* eslint-disable @typescript-eslint/no-explicit-any -- GitHub webhook payloads are provider-defined and narrowed before use. */
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
        const body = await request.text(),
          signature = request.headers.get("x-hub-signature-256") ?? "",
          delivery = request.headers.get("x-github-delivery") ?? "",
          event = request.headers.get("x-github-event") ?? "";
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
        )
          return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
        let payload: any;
        try {
          payload = JSON.parse(body);
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const installationId = payload.installation?.id ?? null,
          repositoryId = payload.repository?.id ?? null;
        const inserted = await (supabaseAdmin as any)
          .from("github_webhook_deliveries")
          .insert({
            delivery_id: delivery,
            event,
            installation_id: installationId,
            repository_id: repositoryId,
            action: payload.action,
            status: supported.has(event) ? "received" : "ignored",
            signature_valid: true,
          })
          .select("delivery_id")
          .single();
        if (inserted.error) return Response.json({ error: "Duplicate delivery" }, { status: 409 });
        try {
          if (event === "installation" && payload.action === "deleted")
            await (supabaseAdmin as any)
              .from("github_installations")
              .delete()
              .eq("id", installationId);
          if (
            event === "repository" &&
            ["deleted", "archived", "transferred"].includes(payload.action)
          ) {
            let revoke = (supabaseAdmin as any)
              .from("github_repositories")
              .update({ explicitly_granted: false, revoked_at: new Date().toISOString() })
              .eq("id", repositoryId);
            if (installationId) revoke = revoke.eq("installation_id", installationId);
            await revoke;
          }
          if (repositoryId) {
            let touched = (supabaseAdmin as any)
              .from("github_repositories")
              .update({ last_webhook_at: new Date().toISOString() })
              .eq("id", repositoryId);
            if (installationId) touched = touched.eq("installation_id", installationId);
            await touched;
          }
          await (supabaseAdmin as any)
            .from("github_webhook_deliveries")
            .update({
              status: supported.has(event) ? "processed" : "ignored",
              processed_at: new Date().toISOString(),
            })
            .eq("delivery_id", delivery);
          return Response.json({ accepted: true });
        } catch {
          await (supabaseAdmin as any)
            .from("github_webhook_deliveries")
            .update({ status: "failed", redacted_error: { code: "processing_failed" } })
            .eq("delivery_id", delivery);
          return Response.json({ error: "Webhook processing failed" }, { status: 500 });
        }
      },
    },
  },
});
