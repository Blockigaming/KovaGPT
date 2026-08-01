import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { retryableUnavailable, suppressThenConsumeToken } from "@/lib/endpoint-reliability.mjs";

const MAX_UNSUBSCRIBE_BODY_BYTES = 8 * 1024;
const MAX_TOKEN_CHARS = 1024;

function redactEmail(email: string | null | undefined): string {
  if (!email) return "***";
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  return `${localPart[0]}***@${domain}`;
}

function configuredClient() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey);
}

function validToken(token: string | null): token is string {
  return Boolean(token && token.length <= MAX_TOKEN_CHARS);
}

export const Route = createFileRoute("/email/unsubscribe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const supabase = configuredClient();
        if (!supabase) {
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        const token = new URL(request.url).searchParams.get("token");
        if (!validToken(token)) {
          return Response.json({ error: "Token is required" }, { status: 400 });
        }

        const { data: tokenRecord, error: lookupError } = await supabase
          .from("email_unsubscribe_tokens")
          .select("used_at")
          .eq("token", token)
          .maybeSingle();
        if (lookupError) {
          console.error("Failed to look up unsubscribe token", {
            token_prefix: token.slice(0, 8) + "…",
          });
          return retryableUnavailable("unsubscribe_backend_unavailable");
        }
        if (!tokenRecord) {
          return Response.json({ error: "Invalid or expired token" }, { status: 404 });
        }
        if (tokenRecord.used_at) {
          return Response.json({ valid: false, reason: "already_unsubscribed" });
        }
        return Response.json({ valid: true });
      },

      POST: async ({ request }) => {
        const supabase = configuredClient();
        if (!supabase) {
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (!Number.isFinite(contentLength) || contentLength > MAX_UNSUBSCRIBE_BODY_BYTES) {
          return Response.json({ error: "Request too large" }, { status: 413 });
        }

        const url = new URL(request.url);
        let token: string | null = url.searchParams.get("token");
        const contentType = request.headers.get("content-type") ?? "";
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const formText = await request.text();
          if (formText.length > MAX_UNSUBSCRIBE_BODY_BYTES) {
            return Response.json({ error: "Request too large" }, { status: 413 });
          }
          const params = new URLSearchParams(formText);
          if (!params.get("List-Unsubscribe")) token = params.get("token") || token;
        } else {
          try {
            const raw = await request.text();
            if (raw.length > MAX_UNSUBSCRIBE_BODY_BYTES) {
              return Response.json({ error: "Request too large" }, { status: 413 });
            }
            const body = JSON.parse(raw) as { token?: unknown };
            if (typeof body.token === "string") token = body.token;
          } catch {
            // RFC 8058 clients commonly send an empty body; the query token remains authoritative.
          }
        }

        if (!validToken(token)) {
          return Response.json({ error: "Token is required" }, { status: 400 });
        }

        const { data: tokenRecord, error: lookupError } = await supabase
          .from("email_unsubscribe_tokens")
          .select("email, used_at")
          .eq("token", token)
          .maybeSingle();
        if (lookupError) {
          console.error("Failed to look up unsubscribe token", {
            token_prefix: token.slice(0, 8) + "…",
          });
          return retryableUnavailable("unsubscribe_backend_unavailable");
        }
        if (!tokenRecord || typeof tokenRecord.email !== "string") {
          return Response.json({ error: "Invalid or expired token" }, { status: 404 });
        }

        const normalizedEmail = tokenRecord.email.trim().toLowerCase();
        if (!normalizedEmail) {
          console.error("Unsubscribe token has no usable email", {
            token_prefix: token.slice(0, 8) + "…",
          });
          return retryableUnavailable("unsubscribe_backend_unavailable");
        }

        try {
          // Suppression is the durable user-facing outcome. It must happen before
          // the token is consumed, and every retry reasserts it idempotently.
          await suppressThenConsumeToken({
            alreadyUsed: Boolean(tokenRecord.used_at),
            suppress: async () =>
              await supabase
                .from("suppressed_emails")
                .upsert({ email: normalizedEmail, reason: "unsubscribe" }, { onConflict: "email" }),
            consume: async () =>
              await supabase
                .from("email_unsubscribe_tokens")
                .update({ used_at: new Date().toISOString() })
                .eq("token", token)
                .is("used_at", null)
                .select("token")
                .maybeSingle(),
          });
        } catch (error) {
          console.error("Failed to durably process unsubscribe", {
            error,
            email_redacted: redactEmail(normalizedEmail),
          });
          return retryableUnavailable("unsubscribe_backend_unavailable");
        }

        console.log("Email unsubscribed", { email_redacted: redactEmail(normalizedEmail) });
        return Response.json({ success: true });
      },
    },
  },
});
