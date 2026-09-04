import * as React from "react";
import { render } from "@react-email/components";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TEMPLATES } from "@/lib/email-templates/registry";
import type { Database } from "@/integrations/supabase/types";
import { resolveBackendUrl } from "@/lib/backend-url";
import { resolveAnonymousClientKey } from "@/lib/chat-ingress.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { BodyReadError, readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";

const SITE_NAME = "KovaGPT";
const SENDER_DOMAIN = "notify.kovagpt.com";
const FROM_ADDRESS =
  process.env.KOVA_EMAIL_FROM?.trim() || `${SITE_NAME} <noreply@${SENDER_DOMAIN}>`;
const MAX_BODY_BYTES = 32 * 1024;

const BodySchema = z.object({
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
  const messageId = randomToken();
  // The email API rejects transactional sends without an unsubscribe token,
  // so the internal support recipient needs one too.
  const unsubscribeToken = await unsubscribeTokenFor(args.supabase, recipient);
  const payload = {
    message_id: messageId,
    to: recipient,
    from: FROM_ADDRESS,
    sender_domain: SENDER_DOMAIN,
    subject,
    html,
    text: plainText,
    purpose: "transactional",
    label: args.templateName,
    idempotency_key: args.idempotencyKey,
    unsubscribe_token: unsubscribeToken,
    queued_at: new Date().toISOString(),
  };
  const { data: queuedMessageId, error } = await args.supabase.rpc(
    "enqueue_tracked_email" as never,
    {
      p_queue_name: "transactional_emails",
      p_payload: payload,
      p_template_name: args.templateName,
      p_recipient_email: recipient,
    } as never,
  );
  if (error || queuedMessageId === null) {
    throw new Error(error?.message ?? "Failed to enqueue email");
  }
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

        let rawText: string;
        try {
          rawText = await readUtf8BodyBounded(request, MAX_BODY_BYTES);
        } catch (error) {
          if (error instanceof BodyReadError) {
            return Response.json(
              {
                error: error.status === 413 ? "Request too large" : "Invalid request body",
              },
              { status: error.status },
            );
          }
          return Response.json({ error: "Invalid request body" }, { status: 400 });
        }

        let raw: unknown;
        try {
          raw = JSON.parse(rawText);
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ error: "Please fill in all required fields." }, { status: 400 });
        }
        const body = parsed.data;
        if (body.website) {
          // Honeypot tripped - pretend success so bots don't probe.
          return Response.json({ success: true });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const idem = randomToken();

        try {
          // Public submissions may send only to the template's fixed internal
          // recipient. The submitted address stays in the notification so
          // support can reply manually, but it is never an outbound target.
          await enqueueFixedRecipient({
            supabase,
            templateName: "help-contact-notification",
            data: body,
            idempotencyKey: `help-notify-${idem}`,
          });
        } catch {
          console.error("help-submit enqueue failed", {
            error_code: "help_submit_enqueue_failed",
          });
          return Response.json(
            { error: "We couldn't send your message. Please try again in a moment." },
            { status: 500 },
          );
        }

        return Response.json({ success: true });
      },
    },
  },
});
