// Real Gmail actions on the signed-in user's account.
// Actions: search, read, draft, send, trash.
import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { getValidGoogleAccessToken, logAudit } from "@/lib/google-oauth.server";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

function base64UrlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBody(data: string | undefined): string {
  if (!data) return "";
  try {
    return decodeURIComponent(
      escape(
        atob(data.replace(/-/g, "+").replace(/_/g, "/")),
      ),
    );
  } catch {
    return "";
  }
}

function extractText(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeBody(payload.body.data);
  if (Array.isArray(payload.parts)) {
    const textPart = payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (textPart?.body?.data) return decodeBody(textPart.body.data);
    for (const p of payload.parts) {
      const t = extractText(p);
      if (t) return t;
    }
  }
  return "";
}

function buildRawEmail(opts: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  threadId?: string;
}): string {
  const headers = [`To: ${opts.to}`, `Subject: ${opts.subject}`];
  if (opts.cc) headers.push(`Cc: ${opts.cc}`);
  headers.push('Content-Type: text/plain; charset="UTF-8"', "MIME-Version: 1.0");
  const raw = `${headers.join("\r\n")}\r\n\r\n${opts.body}`;
  return base64UrlEncode(raw);
}

export const Route = createFileRoute("/api/google/gmail")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        const action = body?.action as string;
        let token: string;
        try {
          token = await getValidGoogleAccessToken(auth.userId);
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
            const list = await listRes.json();
            const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
            const messages = await Promise.all(
              ids.map(async (id) => {
                const r = await fetch(
                  `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
                  { headers: H },
                );
                if (!r.ok) return null;
                const m = await r.json();
                const h = (name: string) =>
                  m.payload?.headers?.find((x: any) => x.name === name)?.value ?? "";
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
            const r = await fetch(`${GMAIL}/messages/${id}?format=full`, { headers: H });
            if (!r.ok) throw new Error(`gmail get ${r.status}`);
            const m = await r.json();
            const h = (name: string) =>
              m.payload?.headers?.find((x: any) => x.name === name)?.value ?? "";
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

          if (action === "draft") {
            const to = String(body.to ?? "").trim();
            const subject = String(body.subject ?? "").slice(0, 300);
            const messageBody = String(body.body ?? "").slice(0, 50000);
            if (!to || !subject) {
              return Response.json({ error: "missing_fields" }, { status: 400 });
            }
            const raw = buildRawEmail({
              to,
              subject,
              body: messageBody,
              cc: body.cc,
              threadId: body.threadId,
            });
            const draftBody: any = { message: { raw } };
            if (body.threadId) draftBody.message.threadId = body.threadId;
            const r = await fetch(`${GMAIL}/drafts`, {
              method: "POST",
              headers: { ...H, "Content-Type": "application/json" },
              body: JSON.stringify(draftBody),
            });
            if (!r.ok) throw new Error(`gmail draft ${r.status} ${await r.text()}`);
            const d = await r.json();
            await logAudit({
              userId: auth.userId,
              provider: "gmail",
              action: "draft",
              resourceId: d.id,
              summary: `Created draft: ${subject} → ${to}`,
            });
            return Response.json({
              draftId: d.id,
              messageId: d.message?.id,
              link: `https://mail.google.com/mail/u/0/#drafts`,
            });
          }

          if (action === "send") {
            // Explicit send. Requires either draftId (send existing draft)
            // or {to, subject, body} for a new send.
            if (body.draftId) {
              const r = await fetch(`${GMAIL}/drafts/send`, {
                method: "POST",
                headers: { ...H, "Content-Type": "application/json" },
                body: JSON.stringify({ id: String(body.draftId) }),
              });
              if (!r.ok) throw new Error(`gmail send draft ${r.status} ${await r.text()}`);
              const m = await r.json();
              await logAudit({
                userId: auth.userId,
                provider: "gmail",
                action: "send",
                resourceId: m.id,
                summary: `Sent draft ${body.draftId}`,
              });
              return Response.json({
                messageId: m.id,
                link: `https://mail.google.com/mail/u/0/#sent/${m.id}`,
              });
            }
            const to = String(body.to ?? "").trim();
            const subject = String(body.subject ?? "").slice(0, 300);
            const messageBody = String(body.body ?? "").slice(0, 50000);
            if (!to || !subject) {
              return Response.json({ error: "missing_fields" }, { status: 400 });
            }
            const raw = buildRawEmail({ to, subject, body: messageBody, cc: body.cc });
            const r = await fetch(`${GMAIL}/messages/send`, {
              method: "POST",
              headers: { ...H, "Content-Type": "application/json" },
              body: JSON.stringify({ raw }),
            });
            if (!r.ok) throw new Error(`gmail send ${r.status} ${await r.text()}`);
            const m = await r.json();
            await logAudit({
              userId: auth.userId,
              provider: "gmail",
              action: "send",
              resourceId: m.id,
              summary: `Sent email: ${subject} → ${to}`,
            });
            return Response.json({
              messageId: m.id,
              link: `https://mail.google.com/mail/u/0/#sent/${m.id}`,
            });
          }

          if (action === "trash") {
            const id = String(body.id ?? "");
            if (!id) return Response.json({ error: "missing_id" }, { status: 400 });
            const r = await fetch(`${GMAIL}/messages/${id}/trash`, {
              method: "POST",
              headers: H,
            });
            if (!r.ok) throw new Error(`gmail trash ${r.status}`);
            await logAudit({
              userId: auth.userId,
              provider: "gmail",
              action: "trash",
              resourceId: id,
              summary: `Moved email ${id} to trash`,
            });
            return Response.json({ ok: true });
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
