import * as React from "react";
import { render } from "@react-email/components";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TEMPLATES } from "@/lib/email-templates/registry";
import type { Database } from "@/integrations/supabase/types";

const SITE_NAME = "KovaGPT";
const SENDER_DOMAIN = "notify.kovagpt.com";
const FROM_DOMAIN = "kovagpt.com";
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
  await args.supabase.from("email_send_log").insert({
    message_id: messageId,
    template_name: args.templateName,
    recipient_email: recipient,
    status: "pending",
  });
  const { error } = await args.supabase.rpc("enqueue_email", {
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
      queued_at: new Date().toISOString(),
    },
  });
  if (error) throw new Error(error.message);
}

// Simple in-memory IP rate limiter: max 5 submissions per hour per IP.
// In-memory state is per-worker-instance, so this is a best-effort guard
// rather than a global hard limit, but defeats trivial scripted abuse.
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 5;
const ipHits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (ipHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_LIMIT) {
    ipHits.set(ip, arr);
    return true;
  }
  arr.push(now);
  ipHits.set(ip, arr);
  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (ipHits.size > 5000) {
    for (const [k, v] of ipHits) {
      const fresh = v.filter((t) => now - t < RATE_WINDOW_MS);
      if (fresh.length === 0) ipHits.delete(k);
      else ipHits.set(k, fresh);
    }
  }
  return false;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export const Route = createFileRoute("/api/public/help-submit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !supabaseServiceKey) {
          return Response.json({ error: "Server not configured" }, { status: 500 });
        }

        const ip = clientIp(request);
        if (rateLimited(ip)) {
          return Response.json(
            { error: "Too many requests. Please try again later." },
            { status: 429 },
          );
        }

        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
          return Response.json({ error: "Request too large" }, { status: 413 });
        }

        const rawText = await request.text();
        if (new TextEncoder().encode(rawText).byteLength > MAX_BODY_BYTES) {
          return Response.json({ error: "Request too large" }, { status: 413 });
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
        } catch (err) {
          console.error("help-submit enqueue failed", err);
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
