// Browser-side helpers for the Google connection + actions.
import { authFetch } from "@/lib/auth-fetch";

export type GoogleStatus = {
  connected: boolean;
  email?: string | null;
  scopes?: string[];
  has?: { gmail: boolean; calendar: boolean; drive: boolean };
};

export async function getGoogleStatus(): Promise<GoogleStatus> {
  const r = await authFetch("/api/google/status");
  if (!r.ok) return { connected: false };
  return r.json();
}

export async function startGoogleConnect(): Promise<void> {
  const r = await authFetch("/api/google/auth");
  if (!r.ok) throw new Error("Could not start Google connection");
  const { url } = (await r.json()) as { url: string };
  window.location.href = url;
}

export async function disconnectGoogleAccount(): Promise<void> {
  await authFetch("/api/google/disconnect", { method: "POST" });
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
export const gmailSearch = (query: string, maxResults = 10) =>
  post<{ messages: GmailMessage[] }>("/api/google/gmail", {
    action: "search",
    query,
    maxResults,
  });
export const gmailRead = (id: string) =>
  post<{
    id: string;
    from: string;
    to: string;
    subject: string;
    date: string;
    body: string;
    link: string;
  }>("/api/google/gmail", { action: "read", id });
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
export const calendarList = (opts?: { timeMin?: string; timeMax?: string; maxResults?: number }) =>
  post<{ events: CalEvent[] }>("/api/google/calendar", { action: "list", ...(opts ?? {}) });
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
export const driveSearch = (query: string, maxResults = 15) =>
  post<{ files: DriveFile[] }>("/api/google/drive", { action: "search", query, maxResults });
export const driveRead = (id: string) =>
  post<{ id: string; name: string; mimeType: string; link: string; content: string }>(
    "/api/google/drive",
    { action: "read", id },
  );
