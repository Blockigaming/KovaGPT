// Google Drive read-only actions.
import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { parseGoogleBinding } from "@/lib/google-account-policy.mjs";
import { getValidGoogleAccessToken, logAudit } from "@/lib/google-oauth.server";
import { enforceGoogleRateLimit } from "@/lib/google-rate-limit.server";
import { enforceLockdownCapability } from "@/lib/lockdown-policy.mjs";

const DRIVE = "https://www.googleapis.com/drive/v3";

type JsonRecord = Record<string, unknown>;

export const Route = createFileRoute("/api/google/drive")({
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
        const limited = await enforceGoogleRateLimit(auth.userId, "drive", 60);
        if (limited) return limited;
        if (Number(request.headers.get("content-length") ?? 0) > 64 * 1024) {
          return Response.json({ error: "request_too_large" }, { status: 413 });
        }
        let body: JsonRecord;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        const action = body?.action as string;
        let token: string;
        try {
          token = await getValidGoogleAccessToken(
            auth.userId,
            parseGoogleBinding({ connectionId: body.connectionId, capability: "drive.read" }),
          );
        } catch {
          return Response.json({ error: "google_not_connected" }, { status: 400 });
        }
        const H = { Authorization: `Bearer ${token}` };

        try {
          if (action === "search") {
            const q = String(body.query ?? "").slice(0, 300);
            const max = Math.min(25, Number(body.maxResults ?? 15));
            const driveQ = q
              ? `name contains '${q.replace(/'/g, "\\'")}' and trashed=false`
              : "trashed=false";
            const url = `${DRIVE}/files?pageSize=${max}&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)&q=${encodeURIComponent(driveQ)}&orderBy=modifiedTime desc`;
            const r = await fetch(url, { headers: H });
            if (!r.ok) throw new Error(`drive list ${r.status}`);
            const j = await r.json();
            await logAudit({
              userId: auth.userId,
              provider: "drive",
              action: "search",
              summary: `Searched Drive for "${q}"`,
            });
            return Response.json({ files: j.files ?? [] });
          }

          if (action === "read") {
            const id = String(body.id ?? "");
            if (!id) return Response.json({ error: "missing_id" }, { status: 400 });
            const metaRes = await fetch(
              `${DRIVE}/files/${id}?fields=id,name,mimeType,webViewLink`,
              { headers: H },
            );
            if (!metaRes.ok) throw new Error(`drive meta ${metaRes.status}`);
            const meta = await metaRes.json();
            let content = "";
            const mt: string = meta.mimeType ?? "";
            if (mt.startsWith("application/vnd.google-apps.")) {
              // Native Google Docs/Sheets/Slides - export to text/csv.
              const exportMime = mt.includes("spreadsheet")
                ? "text/csv"
                : mt.includes("presentation")
                  ? "text/plain"
                  : "text/plain";
              const r = await fetch(
                `${DRIVE}/files/${id}/export?mimeType=${encodeURIComponent(exportMime)}`,
                { headers: H },
              );
              if (r.ok) content = (await r.text()).slice(0, 60000);
            } else if (mt.startsWith("text/") || mt === "application/json") {
              const r = await fetch(`${DRIVE}/files/${id}?alt=media`, { headers: H });
              if (r.ok) content = (await r.text()).slice(0, 60000);
            } else {
              content = `(Binary file: ${mt}. Cannot preview inline.)`;
            }
            await logAudit({
              userId: auth.userId,
              provider: "drive",
              action: "read",
              resourceId: id,
              summary: `Read Drive file: ${meta.name}`,
            });
            return Response.json({
              id: meta.id,
              name: meta.name,
              mimeType: meta.mimeType,
              link: meta.webViewLink,
              content,
            });
          }

          return Response.json({ error: "unknown_action" }, { status: 400 });
        } catch (e) {
          console.error("[drive]", e);
          await logAudit({
            userId: auth.userId,
            provider: "drive",
            action,
            status: "failure",
            summary: (e as Error).message,
          });
          return Response.json({ error: "drive_failed" }, { status: 502 });
        }
      },
    },
  },
});
