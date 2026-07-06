// Read-only Google tool definitions + executor used by the chat
// tool-calling loop. Every tool executes as the signed-in user via
// their stored per-user OAuth token (see google-oauth.server.ts).
//
// Write actions (send email, create event, delete) are intentionally
// NOT exposed here yet — they require the confirmation-card UI which
// is shipped in the next pass. Until then the model can help the user
// draft, review, and search, but never mutates user data unattended.

import { getValidGoogleAccessToken, getGoogleConnection, logAudit } from "@/lib/google-oauth.server";

// OpenAI-compatible function tool schema.
export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

// Human-readable status shown in the chat while a tool runs.
export type ActivityLabel = {
  running: string;
  done: string;
};

export const TOOL_ACTIVITY: Record<string, ActivityLabel> = {
  gmail_search: { running: "Searching Gmail…", done: "Searched Gmail" },
  gmail_read_message: { running: "Reading email…", done: "Read email" },
  calendar_list_events: { running: "Checking your calendar…", done: "Checked calendar" },
  drive_search: { running: "Searching Google Drive…", done: "Searched Drive" },
  drive_read_file: { running: "Reading file…", done: "Read file" },
};

export const READ_ONLY_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "gmail_search",
      description:
        "Search the signed-in user's Gmail inbox. Use for questions like 'do I have any new email from X', 'find the receipt from Amazon', 'what did Sarah send me last week'. Query uses Gmail search syntax (from:, subject:, is:unread, newer_than:7d, etc.).",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Gmail search query. Example: 'from:boss@company.com newer_than:14d'.",
          },
          max_results: {
            type: "integer",
            description: "Max messages to return (1-15). Default 8.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gmail_read_message",
      description:
        "Read the full body of a Gmail message by its id. Call after gmail_search returns an id the user wants to see.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Gmail message id returned from gmail_search." },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calendar_list_events",
      description:
        "List the user's upcoming (or recent) Google Calendar events. Use for 'what's on my schedule today', 'am I free tomorrow at 3', 'what's my next meeting'.",
      parameters: {
        type: "object",
        properties: {
          time_min: {
            type: "string",
            description: "ISO 8601 lower bound. Default = now.",
          },
          time_max: {
            type: "string",
            description: "ISO 8601 upper bound. Default = 7 days from now.",
          },
          max_results: {
            type: "integer",
            description: "Max events to return (1-25). Default 10.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "drive_search",
      description:
        "Search the user's Google Drive files by name. Use for 'find my resume', 'where's the Q3 report'. Returns file metadata + share links.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Substring to match in file names." },
          max_results: { type: "integer", description: "Max files (1-25). Default 10." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "drive_read_file",
      description:
        "Read the text contents of a Drive file by id. Works for text/plain, JSON, and Google Docs/Sheets/Slides (exported). Returns up to ~40k chars of content.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Drive file id from drive_search." },
        },
        required: ["id"],
      },
    },
  },
];

const GMAIL = "https://gmail.googleapis.com/gmail/v1";
const CAL = "https://www.googleapis.com/calendar/v3";
const DRIVE = "https://www.googleapis.com/drive/v3";

function headerValue(headers: Array<{ name: string; value: string }> | undefined, name: string) {
  if (!headers) return "";
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function decodeBase64Url(data: string): string {
  try {
    const b = data.replace(/-/g, "+").replace(/_/g, "/");
    // eslint-disable-next-line no-undef
    return Buffer.from(b, "base64").toString("utf8");
  } catch {
    return "";
  }
}

type GmailPart = {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
function extractPlainText(payload: GmailPart | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const p of payload.parts) {
      const t = extractPlainText(p);
      if (t) return t;
    }
  }
  // Fallback: strip HTML.
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

/**
 * Run one read-only Google tool. Returns a compact JSON-serialisable
 * object that the model consumes as the tool result. Errors are returned
 * as `{ error: string }` rather than thrown so the model can recover.
 */
export async function runGoogleTool(
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let token: string;
  try {
    token = await getValidGoogleAccessToken(userId);
  } catch {
    return { error: "google_not_connected", message: "The user has not connected their Google account. Ask them to connect it on the Apps page." };
  }
  const H: HeadersInit = { Authorization: `Bearer ${token}` };

  try {
    if (name === "gmail_search") {
      const q = String(args.query ?? "").slice(0, 300);
      const max = Math.min(15, Math.max(1, Number(args.max_results ?? 8)));
      const listRes = await fetch(
        `${GMAIL}/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`,
        { headers: H },
      );
      if (!listRes.ok) throw new Error(`gmail list ${listRes.status}`);
      const list = (await listRes.json()) as { messages?: Array<{ id: string }> };
      if (!list.messages || list.messages.length === 0) {
        void logAudit({ userId, provider: "gmail", action: "search", summary: `No results for "${q}"` });
        return { messages: [], note: "No matching messages." };
      }
      // Fetch metadata for each (in parallel, capped).
      const details = await Promise.all(
        list.messages.slice(0, max).map(async (m) => {
          const r = await fetch(
            `${GMAIL}/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: H },
          );
          if (!r.ok) return null;
          const j = (await r.json()) as {
            id: string;
            threadId: string;
            snippet?: string;
            payload?: { headers?: Array<{ name: string; value: string }> };
          };
          return {
            id: j.id,
            threadId: j.threadId,
            from: headerValue(j.payload?.headers, "From"),
            subject: headerValue(j.payload?.headers, "Subject") || "(no subject)",
            date: headerValue(j.payload?.headers, "Date"),
            snippet: (j.snippet ?? "").slice(0, 240),
          };
        }),
      );
      const messages = details.filter(Boolean);
      void logAudit({ userId, provider: "gmail", action: "search", summary: `Searched Gmail: "${q}" (${messages.length} results)` });
      return { messages };
    }

    if (name === "gmail_read_message") {
      const id = String(args.id ?? "");
      if (!id) return { error: "missing_id" };
      const r = await fetch(`${GMAIL}/users/me/messages/${id}?format=full`, { headers: H });
      if (!r.ok) throw new Error(`gmail get ${r.status}`);
      const j = (await r.json()) as {
        id: string;
        snippet?: string;
        payload?: { headers?: Array<{ name: string; value: string }> } & GmailPart;
      };
      const body = extractPlainText(j.payload as GmailPart | undefined).slice(0, 20000);
      void logAudit({ userId, provider: "gmail", action: "read", resourceId: id, summary: `Read email: ${headerValue(j.payload?.headers, "Subject")}` });
      return {
        id: j.id,
        from: headerValue(j.payload?.headers, "From"),
        to: headerValue(j.payload?.headers, "To"),
        subject: headerValue(j.payload?.headers, "Subject") || "(no subject)",
        date: headerValue(j.payload?.headers, "Date"),
        snippet: j.snippet ?? "",
        body,
        link: `https://mail.google.com/mail/u/0/#inbox/${j.id}`,
      };
    }

    if (name === "calendar_list_events") {
      const now = new Date();
      const timeMin = String(args.time_min ?? now.toISOString());
      const timeMax = String(
        args.time_max ?? new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString(),
      );
      const max = Math.min(25, Math.max(1, Number(args.max_results ?? 10)));
      const url = `${CAL}/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=${max}&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
      const r = await fetch(url, { headers: H });
      if (!r.ok) throw new Error(`calendar list ${r.status}`);
      const j = (await r.json()) as {
        items?: Array<{
          id: string;
          summary?: string;
          start?: { dateTime?: string; date?: string; timeZone?: string };
          end?: { dateTime?: string; date?: string };
          location?: string;
          description?: string;
          htmlLink?: string;
          attendees?: Array<{ email: string; responseStatus?: string }>;
        }>;
      };
      const events = (j.items ?? []).map((e) => ({
        id: e.id,
        summary: e.summary ?? "(no title)",
        start: e.start,
        end: e.end,
        location: e.location,
        description: (e.description ?? "").slice(0, 500),
        link: e.htmlLink,
        attendees: (e.attendees ?? []).slice(0, 10).map((a) => a.email),
      }));
      void logAudit({ userId, provider: "calendar", action: "list", summary: `Listed ${events.length} calendar event(s)` });
      return { events };
    }

    if (name === "drive_search") {
      const q = String(args.query ?? "").slice(0, 200);
      const max = Math.min(25, Math.max(1, Number(args.max_results ?? 10)));
      const driveQ = q
        ? `name contains '${q.replace(/'/g, "\\'")}' and trashed=false`
        : "trashed=false";
      const url = `${DRIVE}/files?pageSize=${max}&fields=files(id,name,mimeType,modifiedTime,webViewLink,size,owners(displayName))&q=${encodeURIComponent(driveQ)}&orderBy=modifiedTime desc`;
      const r = await fetch(url, { headers: H });
      if (!r.ok) throw new Error(`drive list ${r.status}`);
      const j = (await r.json()) as {
        files?: Array<{
          id: string;
          name: string;
          mimeType: string;
          modifiedTime: string;
          webViewLink: string;
          size?: string;
          owners?: Array<{ displayName?: string }>;
        }>;
      };
      const files = (j.files ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        mime_type: f.mimeType,
        modified: f.modifiedTime,
        link: f.webViewLink,
        size: f.size,
        owner: f.owners?.[0]?.displayName,
      }));
      void logAudit({ userId, provider: "drive", action: "search", summary: `Searched Drive: "${q}" (${files.length} files)` });
      return { files };
    }

    if (name === "drive_read_file") {
      const id = String(args.id ?? "");
      if (!id) return { error: "missing_id" };
      const metaRes = await fetch(
        `${DRIVE}/files/${id}?fields=id,name,mimeType,webViewLink`,
        { headers: H },
      );
      if (!metaRes.ok) throw new Error(`drive meta ${metaRes.status}`);
      const meta = (await metaRes.json()) as {
        id: string;
        name: string;
        mimeType: string;
        webViewLink: string;
      };
      let content = "";
      const mt = meta.mimeType ?? "";
      if (mt.startsWith("application/vnd.google-apps.")) {
        const exportMime = mt.includes("spreadsheet")
          ? "text/csv"
          : mt.includes("presentation")
            ? "text/plain"
            : "text/plain";
        const r = await fetch(
          `${DRIVE}/files/${id}/export?mimeType=${encodeURIComponent(exportMime)}`,
          { headers: H },
        );
        if (r.ok) content = (await r.text()).slice(0, 40000);
      } else if (mt.startsWith("text/") || mt === "application/json") {
        const r = await fetch(`${DRIVE}/files/${id}?alt=media`, { headers: H });
        if (r.ok) content = (await r.text()).slice(0, 40000);
      } else {
        content = `(Binary file: ${mt}. Cannot preview inline; open ${meta.webViewLink} to view.)`;
      }
      void logAudit({ userId, provider: "drive", action: "read", resourceId: id, summary: `Read Drive file: ${meta.name}` });
      return {
        id: meta.id,
        name: meta.name,
        mime_type: meta.mimeType,
        link: meta.webViewLink,
        content,
      };
    }

    return { error: "unknown_tool", name };
  } catch (e) {
    console.error(`[tool ${name}] failed`, e);
    return { error: "tool_failed", message: (e as Error).message };
  }
}

/** Cheap check: is the user's Google account connected at all? */
export async function userHasGoogle(userId: string): Promise<boolean> {
  const conn = await getGoogleConnection(userId);
  return !!conn;
}
