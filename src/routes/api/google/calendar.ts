// Real Google Calendar CRUD on the signed-in user's primary calendar.
import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { getValidGoogleAccessToken, logAudit } from "@/lib/google-oauth.server";

const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary";

export const Route = createFileRoute("/api/google/calendar")({
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
        const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

        try {
          if (action === "list") {
            const timeMin = String(body.timeMin ?? new Date().toISOString());
            const timeMax = String(
              body.timeMax ??
                new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            );
            const max = Math.min(50, Number(body.maxResults ?? 25));
            const url = `${CAL}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(
              timeMin,
            )}&timeMax=${encodeURIComponent(timeMax)}&maxResults=${max}`;
            const r = await fetch(url, { headers: H });
            if (!r.ok) throw new Error(`calendar list ${r.status}`);
            const j = await r.json();
            const events = (j.items ?? []).map((e: any) => ({
              id: e.id,
              summary: e.summary,
              start: e.start,
              end: e.end,
              location: e.location,
              description: e.description,
              attendees: e.attendees,
              link: e.htmlLink,
            }));
            await logAudit({
              userId: auth.userId,
              provider: "calendar",
              action: "list",
              summary: `Listed ${events.length} calendar events`,
            });
            return Response.json({ events });
          }

          if (action === "create") {
            if (!body.summary || !body.start || !body.end) {
              return Response.json({ error: "missing_fields" }, { status: 400 });
            }
            const event: any = {
              summary: String(body.summary).slice(0, 300),
              description: body.description ? String(body.description).slice(0, 8000) : undefined,
              location: body.location ? String(body.location).slice(0, 500) : undefined,
              start: body.start,
              end: body.end,
              attendees: Array.isArray(body.attendees)
                ? body.attendees.slice(0, 25).map((e: string) => ({ email: String(e) }))
                : undefined,
            };
            const r = await fetch(`${CAL}/events`, {
              method: "POST",
              headers: H,
              body: JSON.stringify(event),
            });
            if (!r.ok) throw new Error(`calendar create ${r.status} ${await r.text()}`);
            const j = await r.json();
            await logAudit({
              userId: auth.userId,
              provider: "calendar",
              action: "create",
              resourceId: j.id,
              summary: `Created event: ${event.summary}`,
            });
            return Response.json({ id: j.id, link: j.htmlLink });
          }

          if (action === "update") {
            const id = String(body.id ?? "");
            if (!id) return Response.json({ error: "missing_id" }, { status: 400 });
            const patch: any = {};
            for (const k of ["summary", "description", "location", "start", "end"]) {
              if (body[k] !== undefined) patch[k] = body[k];
            }
            const r = await fetch(`${CAL}/events/${id}`, {
              method: "PATCH",
              headers: H,
              body: JSON.stringify(patch),
            });
            if (!r.ok) throw new Error(`calendar update ${r.status}`);
            const j = await r.json();
            await logAudit({
              userId: auth.userId,
              provider: "calendar",
              action: "update",
              resourceId: id,
              summary: `Updated event ${id}`,
            });
            return Response.json({ id: j.id, link: j.htmlLink });
          }

          if (action === "delete") {
            const id = String(body.id ?? "");
            if (!id) return Response.json({ error: "missing_id" }, { status: 400 });
            const r = await fetch(`${CAL}/events/${id}`, { method: "DELETE", headers: H });
            if (!r.ok && r.status !== 410) throw new Error(`calendar delete ${r.status}`);
            await logAudit({
              userId: auth.userId,
              provider: "calendar",
              action: "delete",
              resourceId: id,
              summary: `Deleted event ${id}`,
            });
            return Response.json({ ok: true });
          }

          return Response.json({ error: "unknown_action" }, { status: 400 });
        } catch (e) {
          console.error("[calendar]", e);
          await logAudit({
            userId: auth.userId,
            provider: "calendar",
            action,
            status: "failure",
            summary: (e as Error).message,
          });
          return Response.json({ error: "calendar_failed" }, { status: 502 });
        }
      },
    },
  },
});
