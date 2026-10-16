import { loose } from "@/lib/supabase-loose";
import { readCollectionPage, type CollectionPage } from "@/lib/read-bounded-collection";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

const mutationSchema = z.object({
  ids: z
    .array(z.string().uuid())
    .min(1)
    .max(50)
    .transform((ids) => [...new Set(ids)]),
  source: z.enum(["application", "agent"]),
});

const NotificationPageInput = z.object({
  source: z.enum(["application", "agent"]),
  cursor: z.string().uuid().nullable().default(null),
});
export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => NotificationPageInput.parse(input))
  .handler(async ({ data, context }): Promise<CollectionPage<CenterNotification>> => {
    const application = data.source === "application";
    const page = await readCollectionPage<NotificationRow>(
      (signal) => {
        let query = loose(context.supabase)
          .from(application ? "app_notifications" : "agent_notifications")
          .select(
            application
              ? "id,type,title,safe_preview,action_url,read_at,created_at"
              : "id,type,title,action_url,read_at,created_at",
          )
          .eq("owner_id", context.userId)
          .order("id", { ascending: true })
          .limit(25)
          .abortSignal(signal);
        const now = new Date().toISOString();
        query = application
          ? query.or(`expires_at.is.null,expires_at.gt.${now}`)
          : query.gt("expires_at", now);
        if (data.cursor) query = query.gt("id", data.cursor);
        return query;
      },
      application ? "Application notifications" : "Agent notifications",
      data.cursor,
      25,
    );
    return {
      cursor: page.cursor,
      items: page.items.map((item) => ({
        id: item.id,
        source: data.source,
        type: item.type,
        title: item.title,
        preview: application
          ? (item.safe_preview ?? "")
          : "Agent notification received. Details are hidden by default.",
        actionUrl: item.action_url,
        readAt: item.read_at,
        createdAt: item.created_at,
      })),
    };
  });

export const readNotificationDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ id: string; body: string }> => {
    const page = await readCollectionPage<{ id: string; body: string }>(
      (signal) =>
        loose(context.supabase)
          .from("agent_notifications")
          .select("id,body")
          .eq("owner_id", context.userId)
          .eq("id", data.id)
          .gt("expires_at", new Date().toISOString())
          .limit(1)
          .abortSignal(signal),
      "Notification details",
      null,
      1,
    );
    if (
      page.items.length !== 1 ||
      page.items[0].id !== data.id ||
      typeof page.items[0].body !== "string"
    )
      throw new Error("Notification details are unavailable.");
    return page.items[0];
  });

async function updateTables(
  client: LooseClient,
  ownerId: string,
  input: z.infer<typeof mutationSchema>,
  operation: "read" | "delete",
) {
  const table = input.source === "agent" ? "agent_notifications" : "app_notifications";
  const query =
    operation === "read"
      ? client.from(table).update({ read_at: new Date().toISOString() })
      : client.from(table).delete();
  const { data, error } = await query
    .eq("owner_id", ownerId)
    .in("id", input.ids)
    .select("id")
    .abortSignal(AbortSignal.timeout(15000));
  if (error || !Array.isArray(data))
    throw new Error(
      "Notification change could not be confirmed. Refresh this source before retrying.",
    );
  return data.map((row) => String(row.id));
}

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => mutationSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ids = await updateTables(
      context.supabase as unknown as LooseClient,
      context.userId,
      data,
      "read",
    );
    return { ok: true, ids };
  });

export const deleteNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => mutationSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ids = await updateTables(
      context.supabase as unknown as LooseClient,
      context.userId,
      data,
      "delete",
    );
    return { ok: true, ids };
  });
