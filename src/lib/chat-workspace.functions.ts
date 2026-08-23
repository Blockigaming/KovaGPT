import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  parseBranchInput,
  parseChatId,
  parseCustomRulesInput,
  parseMessageVersionInput,
  parsePinInput,
  parseUnpinInput,
  MAX_BRANCHES_PER_CHAT,
  MAX_PINS_PER_CHAT,
  MAX_VERSIONS_PER_MESSAGE,
} from "@/lib/chat-workspace-contract.mjs";

export type MessageVersionDto = {
  id: string;
  messageId: string;
  version: number;
  content: string;
  instruction: string | null;
  selectionStart: number | null;
  selectionEnd: number | null;
  createdAt: string;
};

export type ChatBranchDto = {
  id: string;
  chatId: string;
  label: string | null;
  parentMessageId: string | null;
  originMessageId: string | null;
  position: number;
  isActive: boolean;
  createdAt: string;
};

export type ChatCustomRulesDto = {
  chatId: string;
  rules: string;
  enabled: boolean;
  updatedAt: string;
};

export type ChatPinnedFileDto = {
  id: string;
  chatId: string;
  fileId: string | null;
  fileName: string | null;
  projectId: string | null;
  position: number;
};

/* ------------------------------------------------------------------ *
 * Message versions — durable history for edited assistant/user text.
 * ------------------------------------------------------------------ */

export const listMessageVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chatId: string; messageId?: string }) => ({
    chatId: parseChatId(input?.chatId),
    messageId: input?.messageId ? parseChatId(input.messageId) : null,
  }))
  .handler(async ({ data, context }): Promise<MessageVersionDto[]> => {
    let query = context.supabase
      .from("chat_message_versions")
      .select("id, message_id, version, content, instruction, selection_start, selection_end, created_at")
      .eq("user_id", context.userId)
      .eq("chat_id", data.chatId)
      .order("version", { ascending: true })
      .limit(MAX_VERSIONS_PER_MESSAGE * 20);
    if (data.messageId) query = query.eq("message_id", data.messageId);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((row) => ({
      id: row.id,
      messageId: row.message_id,
      version: row.version,
      content: row.content,
      instruction: row.instruction,
      selectionStart: row.selection_start,
      selectionEnd: row.selection_end,
      createdAt: row.created_at,
    }));
  });

export const saveMessageVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseMessageVersionInput)
  .handler(async ({ data, context }): Promise<MessageVersionDto> => {
    const { data: latest, error: latestError } = await context.supabase
      .from("chat_message_versions")
      .select("version")
      .eq("user_id", context.userId)
      .eq("chat_id", data.chatId)
      .eq("message_id", data.messageId)
      .order("version", { ascending: false })
      .limit(1);
    if (latestError) throw new Error(latestError.message);

    const nextVersion = (latest?.[0]?.version ?? 0) + 1;
    const { data: row, error } = await context.supabase
      .from("chat_message_versions")
      .insert({
        user_id: context.userId,
        chat_id: data.chatId,
        message_id: data.messageId,
        content: data.content,
        version: nextVersion,
        instruction: data.instruction,
        selection_start: data.selectionStart,
        selection_end: data.selectionEnd,
      })
      .select("id, message_id, version, content, instruction, selection_start, selection_end, created_at")
      .single();
    if (error) throw new Error(error.message);

    // Bound growth per message; keep the newest MAX_VERSIONS_PER_MESSAGE.
    if (nextVersion > MAX_VERSIONS_PER_MESSAGE) {
      await context.supabase
        .from("chat_message_versions")
        .delete()
        .eq("user_id", context.userId)
        .eq("chat_id", data.chatId)
        .eq("message_id", data.messageId)
        .lte("version", nextVersion - MAX_VERSIONS_PER_MESSAGE);
    }

    return {
      id: row.id,
      messageId: row.message_id,
      version: row.version,
      content: row.content,
      instruction: row.instruction,
      selectionStart: row.selection_start,
      selectionEnd: row.selection_end,
      createdAt: row.created_at,
    };
  });

/* ------------------------------------------------------------------ *
 * Branches — durable chat tree.
 * ------------------------------------------------------------------ */

export const listChatBranches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chatId: string }) => ({ chatId: parseChatId(input?.chatId) }))
  .handler(async ({ data, context }): Promise<ChatBranchDto[]> => {
    const { data: rows, error } = await context.supabase
      .from("chat_branches")
      .select("id, chat_id, label, parent_message_id, origin_message_id, position, is_active, created_at")
      .eq("user_id", context.userId)
      .eq("chat_id", data.chatId)
      .order("position", { ascending: true })
      .limit(MAX_BRANCHES_PER_CHAT);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      label: row.label,
      parentMessageId: row.parent_message_id,
      originMessageId: row.origin_message_id,
      position: row.position,
      isActive: row.is_active,
      createdAt: row.created_at,
    }));
  });

export const recordChatBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseBranchInput)
  .handler(async ({ data, context }): Promise<ChatBranchDto> => {
    const { count, error: countError } = await context.supabase
      .from("chat_branches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("chat_id", data.chatId);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= MAX_BRANCHES_PER_CHAT) {
      throw new Error(`This chat already has the maximum of ${MAX_BRANCHES_PER_CHAT} branches.`);
    }

    if (data.isActive) {
      await context.supabase
        .from("chat_branches")
        .update({ is_active: false })
        .eq("user_id", context.userId)
        .eq("chat_id", data.chatId);
    }

    const { data: row, error } = await context.supabase
      .from("chat_branches")
      .insert({
        user_id: context.userId,
        chat_id: data.chatId,
        label: data.label,
        parent_message_id: data.parentMessageId,
        origin_message_id: data.originMessageId,
        position: count ?? 0,
        is_active: data.isActive,
      })
      .select("id, chat_id, label, parent_message_id, origin_message_id, position, is_active, created_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      id: row.id,
      chatId: row.chat_id,
      label: row.label,
      parentMessageId: row.parent_message_id,
      originMessageId: row.origin_message_id,
      position: row.position,
      isActive: row.is_active,
      createdAt: row.created_at,
    };
  });

export const activateChatBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chatId: string; branchId: string }) => ({
    chatId: parseChatId(input?.chatId),
    branchId: parseChatId(input?.branchId),
  }))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("chat_branches")
      .update({ is_active: false })
      .eq("user_id", context.userId)
      .eq("chat_id", data.chatId);
    const { error } = await context.supabase
      .from("chat_branches")
      .update({ is_active: true })
      .eq("user_id", context.userId)
      .eq("chat_id", data.chatId)
      .eq("id", data.branchId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/* ------------------------------------------------------------------ *
 * Per-chat custom rules.
 * ------------------------------------------------------------------ */

export const getChatCustomRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chatId: string }) => ({ chatId: parseChatId(input?.chatId) }))
  .handler(async ({ data, context }): Promise<ChatCustomRulesDto | null> => {
    const { data: rows, error } = await context.supabase
      .from("chat_custom_rules")
      .select("chat_id, rules, enabled, updated_at")
      .eq("user_id", context.userId)
      .eq("chat_id", data.chatId)
      .limit(1);
    if (error) throw new Error(error.message);
    const row = rows?.[0];
    if (!row) return null;
    return {
      chatId: row.chat_id,
      rules: row.rules,
      enabled: row.enabled,
      updatedAt: row.updated_at,
    };
  });

export const saveChatCustomRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseCustomRulesInput)
  .handler(async ({ data, context }): Promise<ChatCustomRulesDto> => {
    const { data: row, error } = await context.supabase
      .from("chat_custom_rules")
      .upsert(
        {
          user_id: context.userId,
          chat_id: data.chatId,
          rules: data.rules,
          enabled: data.enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,chat_id" },
      )
      .select("chat_id, rules, enabled, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      chatId: row.chat_id,
      rules: row.rules,
      enabled: row.enabled,
      updatedAt: row.updated_at,
    };
  });

/* ------------------------------------------------------------------ *
 * Pinned files.
 * ------------------------------------------------------------------ */

export const listChatPinnedFiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chatId: string }) => ({ chatId: parseChatId(input?.chatId) }))
  .handler(async ({ data, context }): Promise<ChatPinnedFileDto[]> => {
    const { data: rows, error } = await context.supabase
      .from("chat_pinned_files")
      .select("id, chat_id, file_id, file_name, project_id, position")
      .eq("user_id", context.userId)
      .eq("chat_id", data.chatId)
      .order("position", { ascending: true })
      .limit(MAX_PINS_PER_CHAT);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      fileId: row.file_id,
      fileName: row.file_name,
      projectId: row.project_id,
      position: row.position,
    }));
  });

export const pinChatFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parsePinInput)
  .handler(async ({ data, context }): Promise<ChatPinnedFileDto> => {
    const { count, error: countError } = await context.supabase
      .from("chat_pinned_files")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("chat_id", data.chatId);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= MAX_PINS_PER_CHAT) {
      throw new Error(`You can pin up to ${MAX_PINS_PER_CHAT} files per chat.`);
    }

    const { data: row, error } = await context.supabase
      .from("chat_pinned_files")
      .insert({
        user_id: context.userId,
        chat_id: data.chatId,
        file_id: data.fileId,
        file_name: data.fileName,
        project_id: data.projectId,
        position: count ?? 0,
      })
      .select("id, chat_id, file_id, file_name, project_id, position")
      .single();
    if (error) throw new Error(error.message);
    return {
      id: row.id,
      chatId: row.chat_id,
      fileId: row.file_id,
      fileName: row.file_name,
      projectId: row.project_id,
      position: row.position,
    };
  });

export const unpinChatFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseUnpinInput)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chat_pinned_files")
      .delete()
      .eq("user_id", context.userId)
      .eq("chat_id", data.chatId)
      .eq("id", data.pinId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
