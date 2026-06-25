import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type SharedChatSummary = {
  id: string;
  title: string;
  recipient_email: string;
  status: "pending" | "accepted" | "revoked";
  created_at: string;
};

export type SnapshotMessageDto = { role: "user" | "assistant"; content: string };
export type SharedChatInbox = {
  id: string;
  title: string;
  owner_user_id: string;
  snapshot: { messages: SnapshotMessageDto[] };
  created_at: string;
};

const SnapshotMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(50_000),
});
const ShareSchema = z.object({
  recipient_email: z.string().trim().email().max(255),
  title: z.string().trim().min(1).max(200),
  local_chat_reference: z.string().max(100).optional().nullable(),
  snapshot: z.object({
    messages: z.array(SnapshotMessage).min(1).max(500),
  }),
});

export const shareChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ShareSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const callerEmail =
      (context.claims as { email?: string } | undefined)?.email?.toLowerCase() ?? "";
    if (callerEmail && data.recipient_email.toLowerCase() === callerEmail) {
      throw new Error("You can't share a chat with yourself.");
    }
    const { data: row, error } = await context.supabase
      .from("shared_chats")
      .insert({
        owner_user_id: context.userId,
        recipient_email: data.recipient_email.toLowerCase(),
        title: data.title,
        local_chat_reference: data.local_chat_reference ?? null,
        snapshot: data.snapshot,
        permission: "view",
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Failed to share chat");
    return { id: row.id };
  });

export const listMySharedChats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SharedChatSummary[]> => {
    const { data, error } = await context.supabase
      .from("shared_chats")
      .select("id, title, recipient_email, status, created_at")
      .eq("owner_user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("[listMySharedChats]", error.message);
      return [];
    }
    return (data ?? []) as SharedChatSummary[];
  });

export const listSharedWithMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SharedChatInbox[]> => {
    // RLS already restricts to shares addressed to this user.
    const { data, error } = await context.supabase
      .from("shared_chats")
      .select("id, title, owner_user_id, snapshot, created_at, status, owner_user_id")
      .neq("status", "revoked")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("[listSharedWithMe]", error.message);
      return [];
    }
    // Exclude shares I created myself (owner sees them via My shares).
    return (data ?? [])
      .filter((r) => r.owner_user_id !== context.userId)
      .map((r) => ({
        id: r.id,
        title: r.title,
        owner_user_id: r.owner_user_id,
        snapshot: (r.snapshot as { messages: SnapshotMessageDto[] }) ?? { messages: [] },
        created_at: r.created_at,
      }));
  });

export const revokeSharedChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("shared_chats")
      .update({ status: "revoked" })
      .eq("id", data.id)
      .eq("owner_user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
