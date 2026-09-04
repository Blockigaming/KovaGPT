import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { buildTransactionalEmail, emailOperationFingerprint } from "@/lib/email-queue.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";

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
  operation_id: z.string().uuid(),
  recipient_email: z.string().trim().email().max(255),
  title: z.string().trim().min(1).max(200),
  local_chat_reference: z.string().max(100).optional().nullable(),
  snapshot: z.object({
    messages: z.array(SnapshotMessage).min(1).max(500),
  }),
});

export const shareChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ShareSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const recipientEmail = data.recipient_email.toLowerCase();
    const callerEmail =
      (context.claims as { email?: string } | undefined)?.email?.toLowerCase() ?? "";
    if (callerEmail && recipientEmail === callerEmail) {
      throw new Error("You can't share a chat with yourself.");
    }
    const rateLimit = await consumeApplicationRateLimit({
      identity: `user:${context.userId}`,
      action: "shared_chat_email",
      limit: 20,
      windowSeconds: 3600,
    });
    if (!rateLimit.allowed) {
      throw new Error(
        rateLimit.status === "limited"
          ? "Too many shared chats. Please try again later."
          : "Share protection is temporarily unavailable.",
      );
    }

    const requestFingerprint = await emailOperationFingerprint([
      "shared-chat",
      context.userId,
      recipientEmail,
      data.title,
      data.local_chat_reference ?? null,
      data.snapshot,
    ]);
    const payload = await buildTransactionalEmail({
      templateName: "shared-chat",
      recipientEmail,
      messageId: data.operation_id,
      idempotencyKey: data.operation_id,
      data: {
        chatTitle: data.title,
        senderName: "A KovaGPT user",
        destinationUrl: "https://kovagpt.com/",
      },
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sharedId, error } = await supabaseAdmin.rpc(
      "create_shared_chat_and_enqueue" as never,
      {
        p_actor_id: context.userId,
        p_operation_id: data.operation_id,
        p_request_fingerprint: requestFingerprint,
        p_recipient_email: recipientEmail,
        p_title: data.title,
        p_local_chat_reference: data.local_chat_reference ?? null,
        p_snapshot: data.snapshot,
        p_payload: payload,
      } as never,
    );
    if (error || typeof sharedId !== "string") {
      console.error("[shareChat]", { error_code: "shared_chat_enqueue_failed" });
      throw new Error("The chat could not be shared and emailed.");
    }
    return { id: sharedId };
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
      .select("id, title, owner_user_id, snapshot, created_at, status, owner_user_id")
      .neq("status", "revoked")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("[listSharedWithMe]", error.message);
      throw new Error("Chats shared with you could not be loaded. Please try again.");
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
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("shared_chats")
      .update({ status: "revoked" })
      .eq("id", data.id)
      .eq("owner_user_id", context.userId);
    if (error) {
      console.error("[serverfn]", error.message);
      throw new Error("Request failed. Please try again.");
    }
    return { ok: true };
  });
