// Browser-side helpers for the Google connection + actions.
import { authFetch } from "@/lib/auth-fetch";
import { supabase } from "@/integrations/supabase/client";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function sessionFor(expectedUserId: string, signal: AbortSignal) {
  let rejectAbort: () => void = () => {};
  const canceled = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new Error("Google request timed out."));
  });
  if (signal.aborted) rejectAbort();
  else signal.addEventListener("abort", rejectAbort, { once: true });
  try {
    const { data } = await Promise.race([supabase.auth.getSession(), canceled]);
    if (data.session?.user.id !== expectedUserId || !data.session.access_token || signal.aborted)
      throw new Error("Your account changed. Reload and try again.");
    return data.session;
  } finally {
    signal.removeEventListener("abort", rejectAbort);
  }
}
async function accountRequest(path: string, init: RequestInit, expectedUserId: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const session = await sessionFor(expectedUserId, controller.signal);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${session.access_token}`);
    const response = await fetch(path, {
      ...init,
      headers,
      credentials: path.startsWith("/api/google/auth") ? "same-origin" : "omit",
      signal: controller.signal,
    });

    let body;
    try {
      body =
        response.status === 204
          ? {}
          : JSON.parse(
              new TextDecoder().decode(
                await readResponseBytesBounded(response, 1_048_576, { signal: controller.signal }),
              ),
            );
    } catch {
      throw new Error("Google returned an unavailable or invalid response. Reload and retry.");
    }
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}
function connectionId(value: string) {
  if (!UUID.test(value)) throw new Error("Select a Google account first.");
  return value;
}

export type GoogleAccountStatus = {
  connected: boolean;
  state:
    | "connected"
    | "disconnected"
    | "reauthorization_required"
    | "permission_incomplete"
    | "temporarily_unavailable";
  email?: string | null;
  scopes?: string[];
  has?: {
    gmail: boolean;
    gmailWrite: boolean;
    calendar: boolean;
    calendarWrite: boolean;
    drive: boolean;
  };
};

export type GoogleConnection = GoogleAccountStatus & { id: string; connectionRevision: number };
export type GoogleStatus = GoogleAccountStatus & {
  accounts?: GoogleConnection[];
  selectedConnectionId?: string | null;
  selectionRevision?: number;
};

export async function getGoogleStatus(expectedUserId: string): Promise<GoogleStatus> {
  try {
    const { response, body } = await accountRequest("/api/google/status", {}, expectedUserId);
    if (!response.ok || !body || typeof body.connected !== "boolean")
      throw new Error("Unavailable");
    if (
      body.accounts !== undefined &&
      (!Array.isArray(body.accounts) ||
        body.accounts.length > 20 ||
        body.accounts.some((account: GoogleConnection) => !account || !UUID.test(account.id)))
    )
      throw new Error("Unavailable");
    const states = [
      "connected",
      "disconnected",
      "reauthorization_required",
      "permission_incomplete",
      "temporarily_unavailable",
    ];
    if (
      !states.includes(body.state) ||
      body.accounts?.some(
        (account: GoogleConnection) =>
          typeof account.connected !== "boolean" ||
          !Number.isSafeInteger(account.connectionRevision) ||
          account.connectionRevision < 1 ||
          !states.includes(account.state) ||
          (account.email != null &&
            (typeof account.email !== "string" || account.email.length > 320)),
      )
    )
      throw new Error("Unavailable");
    if (
      body.accounts &&
      (new Set(body.accounts.map((account: GoogleConnection) => account.id)).size !==
        body.accounts.length ||
        !Number.isSafeInteger(body.selectionRevision) ||
        body.selectionRevision < 0 ||
        (body.selectedConnectionId != null &&
          !body.accounts.some(
            (account: GoogleConnection) => account.id === body.selectedConnectionId,
          )))
    )
      throw new Error("Unavailable");
    return body as GoogleStatus;
  } catch {
    return {
      connected: false,
      state: "temporarily_unavailable",
      accounts: [],
      selectedConnectionId: null,
    };
  }
}

export async function startGoogleConnect(
  id: string | undefined,
  expectedUserId: string,
): Promise<void> {
  const suffix = id ? `?connectionId=${encodeURIComponent(connectionId(id))}` : "";
  const { response, body } = await accountRequest(`/api/google/auth${suffix}`, {}, expectedUserId);
  if (!response.ok || typeof body?.url !== "string")
    throw new Error(
      response.status === 503
        ? "Google connection is not configured for this deployment."
        : "Could not start Google connection.",
    );
  const url = new URL(body.url);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "accounts.google.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Invalid Google sign-in destination.");
  await sessionFor(expectedUserId, AbortSignal.timeout(15_000));
  window.location.href = url.href;
}

export async function disconnectGoogleAccount(
  id: string,
  expectedRevision: number,
  expectedUserId: string,
): Promise<void> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    throw new Error("Reload Google accounts before disconnecting.");
  const { response } = await accountRequest(
    "/api/google/disconnect",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: connectionId(id), expectedRevision }),
    },
    expectedUserId,
  );
  if (!response.ok) throw new Error("Could not disconnect this Google account. Reload and retry.");
}

export async function selectGoogleAccount(
  id: string,
  expectedRevision: number,
  expectedUserId: string,
): Promise<void> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new Error("Reload Google accounts before changing selection.");
  const { response } = await accountRequest(
    "/api/google/select",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: connectionId(id), expectedRevision }),
    },
    expectedUserId,
  );
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "Google selection changed elsewhere. Reload and choose again."
        : "Could not select this Google account.",
    );
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await authFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string })?.error ?? "request_failed");
  return j as T;
}

// Gmail
export type GmailMessage = {
  id: string;
  threadId: string;
  snippet: string;
  from: string;
  subject: string;
  date: string;
};
export const gmailSearch = (query: string, maxResults = 10, connectionId?: string) =>
  post<{ messages: GmailMessage[] }>("/api/google/gmail", {
    action: "search",
    query,
    maxResults,
    connectionId,
  });
export const gmailRead = (id: string, connectionId?: string) =>
  post<{
    id: string;
    from: string;
    to: string;
    subject: string;
    date: string;
    body: string;
    link: string;
  }>("/api/google/gmail", { action: "read", id, connectionId });
export const gmailDraft = (opts: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  threadId?: string;
}) =>
  post<{ draftId: string; link: string }>("/api/google/gmail", {
    action: "draft",
    ...opts,
  });
export const gmailSend = (opts: {
  draftId?: string;
  to?: string;
  subject?: string;
  body?: string;
  cc?: string;
}) => post<{ messageId: string; link: string }>("/api/google/gmail", { action: "send", ...opts });
export const gmailTrash = (id: string) =>
  post<{ ok: true }>("/api/google/gmail", { action: "trash", id });

// Calendar
export type CalEvent = {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  description?: string;
  link?: string;
};
export const calendarList = (opts?: {
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  connectionId?: string;
}) => post<{ events: CalEvent[] }>("/api/google/calendar", { action: "list", ...(opts ?? {}) });
export const calendarCreate = (opts: {
  summary: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  description?: string;
  location?: string;
  attendees?: string[];
}) => post<{ id: string; link: string }>("/api/google/calendar", { action: "create", ...opts });
export const calendarDelete = (id: string) =>
  post<{ ok: true }>("/api/google/calendar", { action: "delete", id });

// Drive
export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  size?: string;
};
export const driveSearch = (query: string, maxResults = 15, connectionId?: string) =>
  post<{ files: DriveFile[] }>("/api/google/drive", {
    action: "search",
    query,
    maxResults,
    connectionId,
  });
export const driveRead = (id: string, connectionId?: string) =>
  post<{ id: string; name: string; mimeType: string; link: string; content: string }>(
    "/api/google/drive",
    { action: "read", id, connectionId },
  );
