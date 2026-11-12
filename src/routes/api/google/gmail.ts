// Read-only Gmail access for the signed-in user.
import { createFileRoute } from "@tanstack/react-router";
import { requireUser, getCallerTier } from "@/lib/api-auth.server";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { parseGoogleBinding } from "@/lib/google-account-policy.mjs";
import { getValidGoogleAccessToken, logAudit } from "@/lib/google-oauth.server";
import { enforceGoogleRateLimit } from "@/lib/google-rate-limit.server";
import { enforceLockdownCapability } from "@/lib/lockdown-policy.mjs";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

type JsonRecord = Record<string, unknown>;
type GmailHeader = { name?: string; value?: string };
type GmailPayload = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayload[];
  headers?: GmailHeader[];
};
type GmailMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  payload?: GmailPayload;
};

function decodeBody(data: string | undefined): string {
  if (!data) return "";
  try {
    return decodeURIComponent(escape(atob(data.replace(/-/g, "+").replace(/_/g, "/"))));
  } catch {
    return "";
  }
}

function extractText(payload: GmailPayload | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeBody(payload.body.data);
  if (Array.isArray(payload.parts)) {
    const textPart = payload.parts.find((p) => p.mimeType === "text/plain");
    if (textPart?.body?.data) return decodeBody(textPart.body.data);
    for (const p of payload.parts) {
      const t = extractText(p);
      if (t) return t;
    }
  }
  return "";
}

export const Route = createFileRoute("/api/google/gmail")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
