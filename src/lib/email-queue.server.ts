import * as React from "react";
import { render } from "@react-email/components";
import { TEMPLATES } from "@/lib/email-templates/registry";

const SENDER_DOMAIN = "notify.kovagpt.com";
const DEFAULT_FROM = `KovaGPT <noreply@${SENDER_DOMAIN}>`;
const EMAIL_ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export type QueuedEmailPayload = {
  message_id: string;
  to: string;
  from: string;
  sender_domain: string;
  subject: string;
  html: string;
  text: string;
  purpose: "transactional";
  label: string;
  idempotency_key: string;
  queued_at: string;
};

export async function buildTransactionalEmail(args: {
  templateName: string;
  recipientEmail: string;
  data: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<QueuedEmailPayload> {
  if (process.env.KOVA_EMAIL_QUEUE_ENABLED !== "true") {
    throw new Error("Email delivery is temporarily unavailable.");
  }
  const recipient = args.recipientEmail.trim().toLowerCase();
  if (
    recipient.length > 254 ||
    !EMAIL_ADDRESS.test(recipient) ||
    Array.from(recipient).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new Error("A valid recipient email is required.");
  }
  const entry = TEMPLATES[args.templateName];
  if (!entry || entry.to) {
    throw new Error("Unsupported recipient email template.");
  }
  const element = React.createElement(entry.component, args.data);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  const subject = typeof entry.subject === "function" ? entry.subject(args.data) : entry.subject;
  const messageId = crypto.randomUUID();
  return {
    message_id: messageId,
    to: recipient,
    from: process.env.KOVA_EMAIL_FROM?.trim() || DEFAULT_FROM,
    sender_domain: SENDER_DOMAIN,
    subject,
    html,
    text,
    purpose: "transactional",
    label: args.templateName,
    idempotency_key: args.idempotencyKey?.trim() || messageId,
    queued_at: new Date().toISOString(),
  };
}
