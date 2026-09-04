// Read-only Google Calendar access for the signed-in user's primary calendar.
import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { getValidGoogleAccessToken, logAudit } from "@/lib/google-oauth.server";
import { enforceGoogleRateLimit } from "@/lib/google-rate-limit.server";
import { enforceLockdownCapability } from "@/lib/lockdown-policy.mjs";

const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary";

type JsonRecord = Record<string, unknown>;
type CalendarEvent = JsonRecord & {
  id?: string;
  summary?: string;
  start?: unknown;
  end?: unknown;
  location?: string;
  description?: string;
  attendees?: unknown;
  htmlLink?: string;
};

export const Route = createFileRoute("/api/google/calendar")({
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
        const limited = await enforceGoogleRateLimit(auth.userId, "calendar", 60);
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
        if (action !== "list") {
          return Response.json(
            {
              error: "confirmation_required",
              message: "Prepare a calendar event from chat and confirm it there.",
            },
            { status: 409 },
          );
        }
        let token: string;
        try {
          token = await getValidGoogleAccessToken(auth.userId);
        } catch {
          return Response.json({ error: "google_not_connected" }, { status: 400 });
        }
        const H = {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        };

        try {
          if (action === "list") {
            const timeMin = String(body.timeMin ?? new Date().toISOString());
            const timeMax = String(
              body.timeMax ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            );
            const max = Math.min(50, Number(body.maxResults ?? 25));
            const url = `${CAL}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(
              timeMin,
            )}&timeMax=${encodeURIComponent(timeMax)}&maxResults=${max}`;
            const r = await fetch(url, { headers: H });
            if (!r.ok) throw new Error(`calendar list ${r.status}`);
            const j = (await r.json()) as { items?: CalendarEvent[] };
            const events = (j.items ?? []).map((e) => ({
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
