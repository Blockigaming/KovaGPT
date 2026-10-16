import * as React from "react";
import { render } from "@react-email/components";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { TEMPLATES } from "@/lib/email-templates/registry";
import type { Database } from "@/integrations/supabase/types";
import { resolveBackendUrl } from "@/lib/backend-url";
import { resolveAnonymousClientKey } from "@/lib/chat-ingress.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";

const SITE_NAME = "KovaGPT";
const SENDER_DOMAIN = "notify.kovagpt.com";
const FROM_DOMAIN = "kovagpt.com";
const MAX_BODY_BYTES = 32 * 1024;

const BodySchema = z.object({
  requestId: z.string().uuid(),
  name: z.string().trim().max(120).optional().default(""),
  email: z.string().trim().email().max(254),
  topic: z.string().trim().max(200).optional().default(""),
  message: z.string().trim().min(1).max(4000),
  variant: z.enum(["help", "bug"]).optional().default("help"),
  url: z.string().trim().max(500).optional().default(""),
  userAgent: z.string().trim().max(500).optional().default(""),
  // Honeypot - bots fill hidden fields; humans don't.
  website: z.string().max(0).optional().default(""),
});

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function unsubscribeTokenFor(
  supabase: SupabaseClient<Database>,
  email: string,
): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const { data: existing } = await supabase
    .from("email_unsubscribe_tokens")
    .select("token")
    .eq("email", normalized)
    .maybeSingle();
  if (existing?.token) return existing.token;
  const token = `${randomToken()}${randomToken()}`;
  await supabase
    .from("email_unsubscribe_tokens")
    .upsert({ token, email: normalized }, { onConflict: "email", ignoreDuplicates: true });
  const { data: stored } = await supabase
    .from("email_unsubscribe_tokens")
    .select("token")
    .eq("email", normalized)
    .maybeSingle();
  if (!stored?.token) throw new Error("Failed to prepare unsubscribe token");
  return stored.token;
}

async function enqueueFixedRecipient(args: {
  supabase: SupabaseClient<Database>;
  templateName: string;
  data: Record<string, unknown>;
  idempotencyKey: string;
  requestId: string;
}) {
  if (process.env.KOVA_EMAIL_QUEUE_ENABLED !== "true") {
    throw new Error("Email delivery is not configured");
  }
  const entry = TEMPLATES[args.templateName];
  if (!entry) throw new Error(`Unknown template ${args.templateName}`);
  if (!entry.to) {
    throw new Error("Public support email templates must define a fixed recipient");
  }
  const element = React.createElement(entry.component, args.data);
  const html = await render(element);
  const plainText = await render(element, { plainText: true });
  const subject = typeof entry.subject === "function" ? entry.subject(args.data) : entry.subject;
  const recipient = entry.to.trim().toLowerCase();
  const messageId = args.requestId;
  const fingerprint = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ template: args.templateName, data: args.data })),
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  // Reserve an existing primary key before any queue operation. A retry can
  // read an acknowledged receipt, but can never enqueue the same reservation twice.
  const { error: reserveError } = await args.supabase.from("email_send_log").insert({
    id: messageId,
    message_id: messageId,
    template_name: args.templateName,
    recipient_email: recipient,
    status: "pending",
    metadata: { support_fingerprint: fingerprint },
  });
  if (reserveError) {
    if (reserveError.code !== "23505") throw new Error("Support reservation unavailable");
    const { data: prior, error } = await args.supabase
      .from("email_send_log")
      .select("metadata")
      .eq("id", messageId)
      .maybeSingle();
    const metadata = prior?.metadata as Record<string, unknown> | null;
    if (error || metadata?.support_fingerprint !== fingerprint)
      throw new Error("Support reservation unavailable");
    if (metadata?.support_queued === true)
      return { status: "queued" as const, reference: messageId };
    throw new Error("Support submission outcome is unconfirmed");
  }
  // The email API rejects transactional sends without an unsubscribe token,
  // so the internal support recipient needs one too.
  const unsubscribeToken = await unsubscribeTokenFor(args.supabase, recipient);
  const { data: queueId, error } = await args.supabase.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload: {
      message_id: messageId,
      to: recipient,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text: plainText,
      purpose: "transactional",
      label: args.templateName,
      idempotency_key: args.idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  });
  if (error || !Number.isSafeInteger(queueId) || Number(queueId) <= 0)
    throw new Error("Support queue acknowledgement unavailable");
  const { data: receipt, error: receiptError } = await args.supabase
    .from("email_send_log")
    .update({ metadata: { support_fingerprint: fingerprint, support_queued: true } })
    .eq("id", messageId)
    .select("id")
    .maybeSingle();
  if (receiptError || receipt?.id !== messageId) throw new Error("Support receipt unavailable");
  return { status: "queued" as const, reference: messageId };
}

export const Route = createFileRoute("/api/public/help-submit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = resolveBackendUrl();
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !supabaseServiceKey) {
          return Response.json({ error: "Server not configured" }, { status: 500 });
        }

        const rateLimit = await consumeApplicationRateLimit({
          identity: resolveAnonymousClientKey(request.headers),
          action: "support_submission",
          limit: 5,
          windowSeconds: 3600,
        });
        if (!rateLimit.allowed) {
          return Response.json(
            {
              error:
                rateLimit.status === "limited"
                  ? "Too many requests. Please try again later."
                  : "Request protection is temporarily unavailable.",
            },
            {
              status: rateLimit.status === "limited" ? 429 : 503,
              headers: {
                "Cache-Control": "no-store",
                "Retry-After": String(rateLimit.retryAfter),
              },
            },
          );
        }

        if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
          return Response.json({ error: "JSON is required" }, { status: 415 });
        let raw: unknown;
        try {
          raw = await readBoundedJsonObject(request, MAX_BODY_BYTES);
        } catch (error) {
          return Response.json(
            { error: "Invalid or oversized request" },
            {
              status: error instanceof BoundedJsonError ? error.status : 400,
            },
          );
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ error: "Please fill in all required fields." }, { status: 400 });
        }
        const body = parsed.data;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        try {
          // Public submissions may send only to the template's fixed internal
          // recipient. The submitted address stays in the notification so
          // support can reply manually, but it is never an outbound target.
          const receipt = await enqueueFixedRecipient({
            supabase,
            templateName: "help-contact-notification",
            data: body,
            idempotencyKey: `help-notify-${body.requestId}`,
            requestId: body.requestId,
          });
          return Response.json(
            { success: true, ...receipt },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          console.error("help-submit acceptance unconfirmed");
          return Response.json(
            {
              error:
                "Submission could not be confirmed. Retry this unchanged request to check its receipt; do not submit another copy.",
              reference: body.requestId,
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
