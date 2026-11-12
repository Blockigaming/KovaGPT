// Google tool definitions + executor used by the chat tool-calling loop.
// Every tool executes as the signed-in user via their stored per-user
// OAuth token (see google-oauth.server.ts).
//
// Read tools execute immediately. Supported writes (save a Gmail draft, send a Gmail
// message, and create a calendar event) are gated behind an explicit user confirmation card;
// the chat loop persists the args to `pending_tool_actions` and streams
// a `tool_confirm` SSE event to the browser, and the actual execution
// happens later via /api/chat/confirm.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  getValidGoogleAccessToken,
  canUsePaidGoogleConnector,
  GOOGLE_DOCS_MIME_TYPE,
  getGoogleConnection,
  getGoogleConnectionHealth,
  getGoogleExecutionBinding,
  type GoogleAccountBinding,
  logAudit,
} from "@/lib/google-oauth.server";
import {
  encodeMimeTextBody,
  foldEmailAddressHeader,
  validateSupportedGoogleWrite,
} from "@/lib/google-write-validation.server.mjs";
import { hasGoogleCapability, googleToolCapability } from "@/lib/google-account-policy.mjs";
import { safeConnectorError } from "@/lib/connectors.server";
import { LockdownPolicyError, assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { resolveEffectiveBillingTier } from "@/lib/billing-entitlement.server";

// OpenAI-compatible function tool schema.
export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ActivityLabel = { running: string; done: string };

export const TOOL_ACTIVITY: Record<string, ActivityLabel> = {
  gmail_search: { running: "Searching Gmail…", done: "Searched Gmail" },
  gmail_read_message: { running: "Reading email…", done: "Read email" },
  calendar_list_events: {
    running: "Checking your calendar…",
    done: "Checked calendar",
  },
  drive_search: { running: "Searching Google Drive…", done: "Searched Drive" },
  drive_read_file: { running: "Reading file…", done: "Read file" },
  gmail_create_draft: { running: "Drafting email…", done: "Drafted email" },
  gmail_send: { running: "Preparing email for review…", done: "Email ready for review" },
  calendar_create_event: {
    running: "Preparing calendar event…",
    done: "Prepared calendar event",
  },
};

// Tools the model may call whose *effects* only happen after the user
// explicitly confirms in the UI. runGoogleTool never runs these - the
// chat loop intercepts them and stages a pending action instead.
export const WRITE_TOOL_NAMES = new Set<string>([
  "gmail_create_draft",
  "gmail_send",
  "calendar_create_event",
]);

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
          id: {
            type: "string",
            description: "Gmail message id returned from gmail_search.",
          },
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
          query: {
            type: "string",
            description: "Substring to match in file names.",
          },
          max_results: {
            type: "integer",
            description: "Max files (1-25). Default 10.",
          },
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
          id: {
            type: "string",
            description: "Drive file id from drive_search.",
          },
        },
        required: ["id"],
      },
    },
  },
];

export const WRITE_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "gmail_create_draft",
      description:
        "Create a Gmail DRAFT (not sent). Use when the user asks you to draft, prepare, or write an email they may want to review before sending. The draft will be saved in the user's Drafts folder after they confirm.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Comma-separated recipient email addresses.",
          },
          cc: {
            type: "string",
            description: "Optional. Comma-separated CC addresses.",
          },
          bcc: {
            type: "string",
            description: "Optional. Comma-separated BCC addresses.",
          },
          subject: { type: "string", description: "Email subject line." },
          body: { type: "string", description: "Plain-text email body." },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gmail_send",
      description:
        "Send an email from the user's connected Gmail account. Only call when the user explicitly asks to send an email. The user will review the recipients, subject, and body and confirm before anything is sent.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Comma-separated recipient email addresses.",
          },
          cc: {
            type: "string",
            description: "Optional. Comma-separated CC addresses.",
          },
          bcc: {
            type: "string",
            description: "Optional. Comma-separated BCC addresses.",
          },
          subject: { type: "string", description: "Email subject line." },
          body: { type: "string", description: "Plain-text email body." },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calendar_create_event",
      description:
        "Create a new event on the user's primary Google Calendar. Only call when the user explicitly asks to schedule, add, book, or create a calendar event. The user will confirm before it is created.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Event title." },
          description: {
            type: "string",
            description: "Optional event description.",
          },
          location: {
            type: "string",
            description: "Optional location or meeting link.",
          },
          start: {
            type: "string",
            description:
              "RFC 3339 start time with an explicit timezone, e.g. 2026-07-08T14:00:00-07:00.",
          },
          end: {
            type: "string",
            description:
              "RFC 3339 end time with an explicit timezone. If omitted, defaults to start + 30 minutes.",
          },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "Optional attendee email addresses.",
          },
          timezone: {
            type: "string",
            description: "IANA timezone, e.g. America/Los_Angeles. Optional.",
          },
        },
        required: ["summary", "start"],
      },
    },
  },
];

const SUPPORTED_WRITE_TOOLS = new Set([
  "gmail_create_draft",
  "gmail_send",
  "calendar_create_event",
]);
export const ALL_TOOLS: ToolDef[] = [
  ...READ_ONLY_TOOLS,
  ...WRITE_TOOLS.filter((tool) => SUPPORTED_WRITE_TOOLS.has(tool.function.name)),
];

export async function getAvailableGoogleTools(
  userId: string,
  binding?: GoogleAccountBinding,
): Promise<ToolDef[]> {
  await assertLockdownAllows(admin(), userId, "connector_read");
  // Fail closed for Gmail when billing is unreachable, but avoid disabling
  // the separately entitled free Calendar/Drive tools.
  let paid = false;
  try {
    paid = (await resolveEffectiveBillingTier(admin(), userId)) !== "free";
  } catch {
    paid = false;
  }
  const health = await getGoogleConnectionHealth(userId, binding?.connectionId);
  if (!health.connected) return [];
