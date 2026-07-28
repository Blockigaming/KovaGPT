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
  ids: z.array(z.string().uuid()).max(200).optional(),
  source: z.enum(["application", "agent", "all"]).default("all"),
});

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CenterNotification[]> => {
    const client = context.supabase as unknown as LooseClient;
    const [application, agent] = await Promise.all([
      client
        .from("app_notifications")
        .select("id,type,title,safe_preview,action_url,read_at,created_at")
        .eq("owner_id", context.userId)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order("created_at", { ascending: false })
        .limit(100),
      client
        .from("agent_notifications")
        .select("id,type,title,body,action_url,read_at,created_at")
        .eq("owner_id", context.userId)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (application.error) throw new Error("Unable to load notifications");
    // The agent migration can be deployed independently. Do not hide ordinary notifications while
    // an operator is applying it, but never invent agent rows.
    const rows: CenterNotification[] = ((application.data ?? []) as NotificationRow[]).map(
      (item) => ({
        id: item.id,
        source: "application",
        type: item.type,
        title: item.title,
        preview: item.safe_preview ?? "",
        actionUrl: item.action_url,
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
          actionUrl: item.action_url,
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
      if (input.ids?.length) query = query.in("id", input.ids);
      const { error } = await query;
      if (error && !String(error.message).includes("agent_notifications"))
        throw new Error("Unable to update notifications");
    }),
  );
}

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => mutationSchema.parse(input))
  .handler(async ({ data, context }) => {
    await updateTables(context.supabase as unknown as LooseClient, context.userId, data, "read");
    return { ok: true };
  });

export const deleteNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    mutationSchema.extend({ ids: z.array(z.string().uuid()).min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await updateTables(context.supabase as unknown as LooseClient, context.userId, data, "delete");
    return { ok: true };
  });
