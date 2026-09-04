import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";

// -------- Types --------
export type SummaryProject = { id: string; name: string; color: string | null; updated_at: string };
export type SummaryImage = {
  id: string;
  title: string;
  file_url: string | null;
  created_at: string;
};
export type SummaryFile = {
  id: string;
  title: string;
  file_url: string | null;
  file_type: string | null;
  created_at: string;
};
export type SummaryTask = {
  id: string;
  title: string;
  due_at: string | null;
  source: "project" | "scheduled";
  project_id?: string;
};
export type GmailMessage = {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
};
export type CalendarEvent = {
  id: string;
  title: string;
  start: string | null;
  location: string | null;
  link: string | null;
};
export type GoogleStatus = { connected: boolean; email: string | null; scopes: string[] };

// -------- Recent projects --------
export const getSummaryProjects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SummaryProject[]> => {
    const { data: mem } = await context.supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", context.userId);
    const ids = (mem ?? []).map((m) => m.project_id);
    if (ids.length === 0) return [];
    const { data } = await context.supabase
      .from("projects")
      .select("id, name, color, updated_at")
      .in("id", ids)
      .order("updated_at", { ascending: false })
      .limit(6);
    return (data ?? []) as SummaryProject[];
  });

// -------- Recent library images --------
export const getSummaryImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SummaryImage[]> => {
    const { data } = await context.supabase
      .from("user_library_items")
      .select("id, title, file_url, created_at")
      .eq("user_id", context.userId)
      .eq("item_type", "image")
      .order("created_at", { ascending: false })
      .limit(6);
    return (data ?? []) as SummaryImage[];
  });

// -------- Recent library files --------
export const getSummaryFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SummaryFile[]> => {
    const { data } = await context.supabase
      .from("user_library_items")
      .select("id, title, file_url, file_type, created_at")
      .eq("user_id", context.userId)
      .in("item_type", ["upload", "document", "code"])
      .order("created_at", { ascending: false })
      .limit(6);
    return (data ?? []) as SummaryFile[];
  });

// -------- Combined open tasks (scheduled + project) --------
export const getSummaryTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SummaryTask[]> => {
    const [sched, mem] = await Promise.all([
      context.supabase
        .from("scheduled_tasks")
        .select("id, title, next_run_at, run_at, status")
        .eq("user_id", context.userId)
        .in("status", ["scheduled", "running"])
        .order("run_at", { ascending: true })
        .limit(5),
      context.supabase.from("project_members").select("project_id").eq("user_id", context.userId),
    ]);
    const projectIds = (mem.data ?? []).map((m) => m.project_id);
    let projectRows: Array<{
      id: string;
      title: string;
      due_date: string | null;
      project_id: string;
    }> = [];
    if (projectIds.length) {
      const { data } = await context.supabase
        .from("project_tasks")
        .select("id, title, due_date, project_id, status")
        .in("project_id", projectIds)
        .neq("status", "done")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(6);
      projectRows = (data ?? []) as typeof projectRows;
    }
    const schedTasks: SummaryTask[] = (sched.data ?? []).map(
      (s: { id: string; title: string; next_run_at?: string | null; run_at?: string | null }) => ({
        id: s.id,
        title: s.title,
        due_at: s.next_run_at ?? s.run_at ?? null,
        source: "scheduled" as const,
      }),
    );
    const projTasks: SummaryTask[] = projectRows.map((p) => ({
      id: p.id,
      title: p.title,
      due_at: p.due_date,
      source: "project" as const,
      project_id: p.project_id,
    }));
    return [...projTasks, ...schedTasks].slice(0, 8);
  });

// -------- Google connection status --------
export const getGoogleStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GoogleStatus> => {
    const { data } = await context.supabase
      .from("google_oauth_tokens")
      .select("email, scopes")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!data) return { connected: false, email: null, scopes: [] };
    const scopes =
      typeof data.scopes === "string"
        ? data.scopes.split(/\s+/).filter(Boolean)
        : ((data.scopes as string[] | null) ?? []);
    return { connected: true, email: (data as { email?: string | null }).email ?? null, scopes };
  });

// -------- Gmail summary (only if connected + gmail scope) --------
export const getGmailSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ available: boolean; messages: GmailMessage[] }> => {
    const { getValidGoogleAccessToken } = await import("@/lib/google-oauth.server");
    let token: string;
    try {
      await assertLockdownAllows(context.supabase, context.userId, "connector_read");
      token = await getValidGoogleAccessToken(context.userId);
    } catch {
      return { available: false, messages: [] };
    }
    const listRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=is:unread%20in:inbox",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!listRes.ok) return { available: false, messages: [] };
    const list = (await listRes.json()) as { messages?: Array<{ id: string }> };
    if (!list.messages?.length) return { available: true, messages: [] };
    const details = await Promise.all(
      list.messages.slice(0, 5).map(async (m) => {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!r.ok) return null;
        const j = (await r.json()) as {
          id: string;
          snippet?: string;
          payload?: { headers?: Array<{ name: string; value: string }> };
        };
        const hv = (n: string) =>
          j.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
        return {
          id: j.id,
          from: hv("From"),
          subject: hv("Subject") || "(no subject)",
          date: hv("Date"),
          snippet: (j.snippet ?? "").slice(0, 160),
        };
      }),
    );
    return { available: true, messages: details.filter(Boolean) as GmailMessage[] };
  });

// -------- Calendar summary --------
export const getCalendarSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ available: boolean; events: CalendarEvent[] }> => {
    const { getValidGoogleAccessToken } = await import("@/lib/google-oauth.server");
    let token: string;
    try {
      await assertLockdownAllows(context.supabase, context.userId, "connector_read");
      token = await getValidGoogleAccessToken(context.userId);
    } catch {
      return { available: false, events: [] };
    }
    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + 7 * 86400_000).toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=6&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return { available: false, events: [] };
    const j = (await r.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        start?: { dateTime?: string; date?: string };
        location?: string;
        htmlLink?: string;
      }>;
    };
    const events = (j.items ?? []).map((e) => ({
      id: e.id,
      title: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? null,
      location: e.location ?? null,
      link: e.htmlLink ?? null,
    }));
    return { available: true, events };
  });
