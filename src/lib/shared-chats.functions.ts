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
const SnapshotSchema = z.object({
  messages: z.array(SnapshotMessage).min(1).max(500),
});
const ShareSchema = z.object({
  recipient_email: z.string().trim().email().max(255),
  title: z.string().trim().min(1).max(200),
  local_chat_reference: z.string().max(100).optional().nullable(),
  snapshot: SnapshotSchema,
});

export const shareChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ShareSchema.parse(input))
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
    if (error || !row) {
      console.error("[serverfn]", error?.message);
      throw new Error("Failed to share chat");
    }
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
      throw new Error("Shared chats could not be loaded. Please try again.");
    }
    return (data ?? []) as SharedChatSummary[];
  });

export const listSharedWithMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SharedChatInbox[]> => {
    // RLS already restricts to shares addressed to this user.
    const { data, error } = await context.supabase
      .from("shared_chats")
      .select("id, title, owner_user_id, snapshot, created_at, status")
      .neq("status", "revoked")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("[listSharedWithMe]", error.message);
      throw new Error("Chats shared with you could not be loaded. Please try again.");
    }
    // Exclude shares I created myself (owner sees them via My shares).
    return (data ?? []).flatMap((row) => {
      if (row.owner_user_id === context.userId) return [];
      const snapshot = SnapshotSchema.safeParse(row.snapshot);
      if (!snapshot.success) {
        console.warn("[listSharedWithMe] skipped malformed snapshot", row.id);
        return [];
      }
      return [
        {
          id: row.id,
          title: row.title,
          owner_user_id: row.owner_user_id,
          snapshot: snapshot.data,
          created_at: row.created_at,
        },
      ];
    });
  });

export const revokeSharedChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: revoked, error } = await context.supabase
      .from("shared_chats")
      .update({ status: "revoked" })
      .eq("id", data.id)
      .eq("owner_user_id", context.userId)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[serverfn]", error.message);
      throw new Error("Request failed. Please try again.");
    }
    if (!revoked) throw new Error("That shared snapshot was not found or is no longer yours.");
    return { ok: true };
  });
