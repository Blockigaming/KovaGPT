import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { safePersistedNoticeActionUrl } from "@/lib/persisted-notification-policy.mjs";

export type CenterNotification = {
  id: string;
  source: "application" | "agent";
  type: string;
  title: string;
  preview: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

type LooseClient = {
  // Generated Supabase types intentionally lag migrations; this compatibility edge disappears
  // after production type generation and remains server-only in the meantime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
};
type NotificationRow = {
  id: string;
  type: string;
  title: string;
  safe_preview?: string;
  body?: string;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

const ownerSchema = z.object({ expectedOwnerId: z.string().uuid() });
const mutationSchema = ownerSchema.extend({
  ids: z.array(z.string().uuid()).min(1).max(200).optional(),
  source: z.enum(["application", "agent", "all"]).default("all"),
});

function requireInboxOwner(expectedOwnerId: string, ownerId: string) {
  if (expectedOwnerId !== ownerId) throw new Error("The notification account changed");
}

function missingAgentInbox(error: { code?: string } | null) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ownerSchema.parse(input))
  .handler(async ({ data, context }): Promise<CenterNotification[]> => {
    requireInboxOwner(data.expectedOwnerId, context.userId);
    const client = context.supabase as unknown as LooseClient;
    const now = new Date().toISOString();
    const [application, agent] = await Promise.all([
      client
        .from("app_notifications")
        .select("id,type,title,safe_preview,action_url,read_at,created_at")
        .eq("owner_id", context.userId)
        .eq("delivery_state", "delivered")
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order("created_at", { ascending: false })
        .limit(100),
      client
        .from("agent_notifications")
        .select("id,type,title,body,action_url,read_at,created_at")
        .eq("owner_id", context.userId)
        .gt("expires_at", now)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (application.error || (agent.error && !missingAgentInbox(agent.error)))
      throw new Error("Unable to load notifications");
    // The agent migration can be deployed independently. Do not hide ordinary notifications while
    // an operator is applying it, but never invent agent rows.
    const rows: CenterNotification[] = ((application.data ?? []) as NotificationRow[]).map(
      (item) => ({
        id: item.id,
        source: "application",
        type: item.type,
        title: item.title,
        preview: item.safe_preview ?? "",
        actionUrl: safePersistedNoticeActionUrl(item.action_url),
        readAt: item.read_at,
        createdAt: item.created_at,
      }),
    );
    if (!agent.error)
      rows.push(
        ...((agent.data ?? []) as NotificationRow[]).map((item) => ({
          id: item.id,
          source: "agent" as const,
          type: item.type,
          title: item.title,
          preview: item.body ?? "",
          actionUrl: safePersistedNoticeActionUrl(item.action_url),
          readAt: item.read_at,
          createdAt: item.created_at,
        })),
      );
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 150);
  });

async function updateTables(
  client: LooseClient,
  ownerId: string,
  input: z.infer<typeof mutationSchema>,
  operation: "read" | "delete",
) {
  const tables =
    input.source === "all"
      ? ["app_notifications", "agent_notifications"]
      : [input.source === "agent" ? "agent_notifications" : "app_notifications"];
  await Promise.all(
    tables.map(async (table) => {
      let query =
        operation === "read"
          ? client.from(table).update({ read_at: new Date().toISOString() })
          : client.from(table).delete();
      query = query.eq("owner_id", ownerId);
      if (table === "app_notifications") query = query.eq("delivery_state", "delivered");
      if (operation === "read") query = query.is("read_at", null);
      if (input.ids?.length) query = query.in("id", input.ids);
      const { error } = await query;
      if (
        error &&
        !(input.source === "all" && table === "agent_notifications" && missingAgentInbox(error))
      )
        throw new Error("Unable to update notifications");
    }),
  );
}

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => mutationSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireInboxOwner(data.expectedOwnerId, context.userId);
    await updateTables(context.supabase as unknown as LooseClient, context.userId, data, "read");
    return { ok: true };
  });

export const deleteNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    mutationSchema.extend({ ids: z.array(z.string().uuid()).min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireInboxOwner(data.expectedOwnerId, context.userId);
    await updateTables(context.supabase as unknown as LooseClient, context.userId, data, "delete");
    return { ok: true };
  });
