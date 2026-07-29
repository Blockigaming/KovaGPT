import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Conversation } from "@/lib/chat-store";
import type { Json } from "@/integrations/supabase/types";

const attachmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), dataUrl: z.string().max(4_200_000) }),
  z.object({
    kind: z.literal("text_file"),
    name: z.string().min(1).max(500),
    content: z.string().max(256 * 1024),
    fileType: z.string().max(100).nullable().optional(),
    size: z
      .number()
      .int()
      .min(0)
      .max(256 * 1024)
      .nullable()
      .optional(),
  }),
  z.object({
    kind: z.literal("library_file"),
    libraryItemId: z.string().min(1).max(200),
    name: z.string().min(1).max(500),
    fileType: z.string().max(100).nullable().optional(),
    size: z.number().int().min(0).nullable().optional(),
    sourceProject: z.string().max(200).nullable().optional(),
  }),
]);

const messageSchema = z.object({
  id: z.string().min(1).max(200),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(200_000),
  attachments: z.array(attachmentSchema).max(20).optional(),
  pendingImage: z.boolean().optional(),
  activities: z
    .array(
      z.object({
        tool: z.string().max(100),
        label: z.string().max(300),
        status: z.enum(["done", "running"]),
      }),
    )
    .max(100)
    .optional(),
  pendingConfirms: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
});

const conversationSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  messages: z.array(messageSchema).max(1000),
  mode: z.enum(["instant", "medium", "high"]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  pinned: z.boolean().optional(),
  pinnedAt: z.number().int().nonnegative().optional(),
  temporary: z.boolean().optional(),
  branchOrigin: z
    .object({
      conversationId: z.string().max(200),
      messageId: z.string().max(200),
      title: z.string().max(500),
    })
    .optional(),
});

const syncRowSchema = z.object({
  conversation_id: z.string().min(1).max(200),
  payload: conversationSchema,
  archived: z.boolean(),
  deleted: z.boolean(),
  client_updated_at: z.number().int().nonnegative(),
});

export type CloudConversationRow = {
  conversation_id: string;
  payload: Conversation | null;
  archived: boolean;
  deleted: boolean;
  client_updated_at: number;
  server_updated_at: string;
};

export const listCloudConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CloudConversationRow[]> => {
    const { data, error } = await context.supabase
      .from("user_conversations")
      .select("conversation_id, payload, archived, deleted, client_updated_at, server_updated_at")
      .eq("owner_id", context.userId)
      .order("client_updated_at", { ascending: false })
      .limit(1000);
    if (error) {
      console.error("[listCloudConversations]", error.message);
      throw new Error("Cloud chat history could not be loaded. Your device copy is unchanged.");
    }
    return (data ?? []).map((row) => ({
      ...row,
      payload: row.deleted ? null : conversationSchema.parse(row.payload),
    }));
  });

export const syncCloudConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ rows: z.array(syncRowSchema).min(1).max(50) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ synced: number }> => {
    for (const row of data.rows) {
      if (JSON.stringify(row.payload).length > 1_500_000) {
        throw new Error(
          `“${row.payload.title}” is too large for cloud history. It remains safely on this device.`,
        );
      }
      if (row.payload.id !== row.conversation_id || row.payload.temporary) {
        throw new Error("Invalid cloud conversation payload.");
      }
    }
    const payload = data.rows.map((row) => ({
      ...row,
      payload: row.deleted ? {} : row.payload,
    })) as unknown as Json;
    const { data: synced, error } = await context.supabase.rpc("sync_my_conversations", {
      p_rows: payload,
    });
    if (error) {
      console.error("[syncCloudConversations]", error.message);
      throw new Error("Cloud chat history could not be saved. Your device copy is unchanged.");
    }
    return { synced: synced?.length ?? 0 };
  });
