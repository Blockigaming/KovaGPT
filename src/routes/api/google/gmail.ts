// Read-only Gmail access for the signed-in user.
import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
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
        const lockdown = await enforceLockdownCapability(
          auth.supabaseAdmin,
          auth.userId,
          "connector_read",
        );
        if (lockdown) return lockdown;
        const limited = await enforceGoogleRateLimit(auth.userId, "gmail", 60);
        if (limited) return limited;
        let body: JsonRecord;
        try {
          body = await readBoundedJsonObject(request, 64 * 1024);
        } catch (error) {
          if (error instanceof BoundedJsonError) {
            return Response.json({ error: error.code }, { status: error.status });
          }
          return Response.json({ error: "invalid_request_body" }, { status: 400 });
        }
        const action = body?.action as string;
        if (!new Set(["search", "read"]).has(action)) {
          return Response.json(
            {
              error: "confirmation_required",
              message: "Prepare Gmail drafts from chat and confirm the action there.",
            },
            { status: 409 },
          );
        }
        let token: string;
        try {
          token = await getValidGoogleAccessToken(
            auth.userId,
            parseGoogleBinding({ connectionId: body.connectionId, capability: "gmail.read" }),
          );
        } catch {
          return Response.json({ error: "google_not_connected" }, { status: 400 });
        }
        const H = { Authorization: `Bearer ${token}` };

        try {
          if (action === "search") {
            const q = String(body.query ?? "").slice(0, 500);
            const max = Math.min(20, Number(body.maxResults ?? 10));
            const listRes = await fetch(
              `${GMAIL}/messages?q=${encodeURIComponent(q)}&maxResults=${max}`,
              { headers: H },
            );
            if (!listRes.ok) throw new Error(`gmail list ${listRes.status}`);
            const list = (await listRes.json()) as {
              messages?: { id?: string }[];
            };
            const ids: string[] = (list.messages ?? []).map((m) => String(m.id ?? ""));
            const messages = await Promise.all(
              ids.map(async (id) => {
                const r = await fetch(
                  `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
                  { headers: H },
                );
                if (!r.ok) return null;
                const m = (await r.json()) as GmailMessage;
                const h = (name: string) =>
                  m.payload?.headers?.find((x) => x.name === name)?.value ?? "";
                return {
                  id: m.id,
                  threadId: m.threadId,
                  snippet: m.snippet,
                  from: h("From"),
                  subject: h("Subject"),
                  date: h("Date"),
                };
              }),
            );
            await logAudit({
              userId: auth.userId,
              provider: "gmail",
              action: "search",
              summary: `Searched Gmail for "${q}"`,
              metadata: { query: q, results: messages.filter(Boolean).length },
            });
            return Response.json({ messages: messages.filter(Boolean) });
          }

          if (action === "read") {
            const id = String(body.id ?? "");
            if (!id) return Response.json({ error: "missing_id" }, { status: 400 });
            const r = await fetch(`${GMAIL}/messages/${id}?format=full`, {
              headers: H,
            });
            if (!r.ok) throw new Error(`gmail get ${r.status}`);
            const m = (await r.json()) as GmailMessage;
            const h = (name: string) =>
              m.payload?.headers?.find((x) => x.name === name)?.value ?? "";
            const text = extractText(m.payload).slice(0, 30000);
            await logAudit({
              userId: auth.userId,
              provider: "gmail",
              action: "read",
              resourceId: id,
              summary: `Read email: ${h("Subject") || "(no subject)"}`,
            });
            return Response.json({
              id: m.id,
              threadId: m.threadId,
              from: h("From"),
              to: h("To"),
              subject: h("Subject"),
              date: h("Date"),
              body: text,
              link: `https://mail.google.com/mail/u/0/#inbox/${m.id}`,
            });
          }

          return Response.json({ error: "unknown_action" }, { status: 400 });
        } catch (e) {
          console.error("[gmail]", e);
          await logAudit({
            userId: auth.userId,
            provider: "gmail",
            action,
            status: "failure",
            summary: (e as Error).message,
          });
          return Response.json({ error: "gmail_failed" }, { status: 502 });
        }
      },
    },
  },
});
