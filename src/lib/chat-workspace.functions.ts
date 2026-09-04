import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  budgetPinnedContext,
  parseBranchActivationInput,
  parseBranchInput,
  parseChatId,
  parseCustomRulesInput,
  parseMessageId,
  parseMessageIds,
  parseMessageVersionInput,
  parsePinInput,
  parsePinStatusInput,
  parseUnpinInput,
  parseUuid,
  MAX_BRANCHES_PER_CHAT,
  MAX_PINNED_CONTEXT_CHARS,
  MAX_PINNED_ITEM_CHARS,
  MAX_PINS_PER_CHAT,
  MAX_VERSIONS_PER_MESSAGE,
  type MessageVersionSource,
  type PinSourceType,
  type PinStatus,
} from "@/lib/chat-workspace-contract.mjs";
import {
  callWorkspaceRpc,
  definedArgs,
  isMissingFunction,
  type RpcClient,
} from "@/lib/chat-workspace-rpc";

export type MessageVersionDto = {
  id: string;
  chatId: string;
  messageId: string;
  branchId: string | null;
  version: number;
  source: MessageVersionSource;
  instruction: string | null;
  content: string;
  originalContent: string | null;
  selectionStart: number | null;
  selectionEnd: number | null;
  accepted: boolean;
  createdAt: string;
};

export type ChatBranchDto = {
  id: string;
  chatId: string;
  /** Conversation this branch actually displays; a root row maps to the original. */
  conversationId: string;
  parentBranchId: string | null;
  branchFromParentMessageId: string | null;
  branchFromMessageId: string | null;
  branchFromMessageIndex: number | null;
  messageIds: string[];
  label: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ChatCustomRulesDto = {
  id: string;
  chatId: string;
  instructions: string;
  enabled: boolean;
  updatedAt: string;
};

export type ChatPinnedFileDto = {
  id: string;
  chatId: string;
  sourceType: PinSourceType;
  sourceId: string;
  projectId: string | null;
  status: PinStatus;
  createdAt: string;
};

export type PinnedContextDto = {
  items: {
    pinId: string;
    sourceType: PinSourceType;
    sourceId: string;
    projectId: string | null;
    status: PinStatus;
    statusLabel: string;
    name: string;
    content: string;
    truncated: boolean;
    includedChars: number;
  }[];
  usedChars: number;
  totalBudget: number;
  truncatedCount: number;
  skippedCount: number;
  truncated: boolean;
};

const VERSION_COLUMNS =
  "id, chat_id, message_id, branch_id, version, source, instruction, content, original_content, selection_start, selection_end, accepted, created_at";
const BRANCH_COLUMNS =
  "id, chat_id, conversation_id, parent_branch_id, branch_from_parent_message_id, branch_from_message_id, branch_from_message_index, message_ids, label, active, created_at, updated_at";
const RULES_COLUMNS = "id, chat_id, instructions, enabled, updated_at";
const PIN_COLUMNS = "id, chat_id, source_type, source_id, project_id, status, created_at";

type VersionRow = {
  id: string;
  chat_id: string;
  message_id: string;
  branch_id: string | null;
  version: number;
  source: string;
  instruction: string | null;
  content: string;
  original_content: string | null;
  selection_start: number | null;
  selection_end: number | null;
  accepted: boolean;
  created_at: string;
};

type BranchRow = {
  id: string;
  chat_id: string;
  conversation_id: string;
  parent_branch_id: string | null;
  branch_from_parent_message_id: string | null;
  branch_from_message_id: string | null;
  branch_from_message_index: number | null;
  message_ids: string[] | null;
  label: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function toVersion(row: VersionRow): MessageVersionDto {
  return {
    id: row.id,
    chatId: row.chat_id,
    messageId: row.message_id,
    branchId: row.branch_id,
    version: row.version,
    source: row.source as MessageVersionSource,
    instruction: row.instruction,
    content: row.content,
    originalContent: row.original_content,
    selectionStart: row.selection_start,
    selectionEnd: row.selection_end,
    accepted: row.accepted,
    createdAt: row.created_at,
  };
}

function toBranch(row: BranchRow): ChatBranchDto {
  return {
    id: row.id,
    chatId: row.chat_id,
    conversationId: row.conversation_id,
    parentBranchId: row.parent_branch_id,
    branchFromParentMessageId: row.branch_from_parent_message_id,
    branchFromMessageId: row.branch_from_message_id,
    branchFromMessageIndex: row.branch_from_message_index,
    messageIds: row.message_ids ?? [],
    label: row.label,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Map opaque database errors onto messages a person can act on. */
function rpcError(message: string): Error {
  if (message.includes("not_authenticated")) return new Error("Please sign in again.");
  if (message.includes("branch_limit_reached")) {
    return new Error(`This chat already has the maximum of ${MAX_BRANCHES_PER_CHAT} branches.`);
  }
  if (message.includes("parent_branch_not_found")) {
    return new Error("That parent branch is not part of this chat.");
  }
  if (message.includes("branch_not_found")) return new Error("That branch no longer exists.");
  if (message.includes("version_not_found")) return new Error("That version no longer exists.");
  if (message.includes("lineage cycle")) return new Error("Branches cannot form a loop.");
  if (message.includes("branch_conversation_exists")) {
    return new Error("That conversation is already saved as a branch.");
  }
  if (message.includes("conversation_required")) {
    return new Error("A conversation is required to save a branch.");
  }
  if (message.includes("invalid_source")) return new Error("That version source is not valid.");
  if (message.includes("too_many_messages")) {
    return new Error("That branch has too many messages.");
  }
  // Anything else is an unexpected database or provider fault: never surface raw
  // SQL, constraint names or connection details to a person.
  return new Error("Something went wrong saving that. Please try again.");
}

/** Table reads/writes go through the same safe-message funnel as the RPCs. */
function dbError(message: string): Error {
  if (/permission denied|42501/i.test(message)) {
    return new Error("You do not have access to that.");
  }
  return new Error("Something went wrong. Please try again.");
}

/* ------------------------------------------------------------------ *
 * Message versions — durable, concurrency-safe edit history.
 * ------------------------------------------------------------------ */

export const listMessageVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chatId: string; messageId?: string }) => ({
    chatId: parseChatId(input?.chatId),
    messageId: input?.messageId ? parseMessageId(input.messageId) : null,
  }))
  .handler(async ({ data, context }): Promise<MessageVersionDto[]> => {
    let query = context.supabase
      .from("chat_message_versions")
      .select(VERSION_COLUMNS)
      .eq("owner_id", context.userId)
      .eq("chat_id", data.chatId)
      .order("message_id", { ascending: true })
      .order("version", { ascending: true })
      .limit(MAX_VERSIONS_PER_MESSAGE * 20);
    if (data.messageId) query = query.eq("message_id", data.messageId);
    const { data: rows, error } = await query;
    if (error) throw dbError(error.message);
    return (rows ?? []).map((row) => toVersion(row as unknown as VersionRow));
  });

/**
 * Allocation of the next version number happens inside a locked RPC, so
 * simultaneous edits of the same message can never collide on the
 * (owner, chat, message, version) unique constraint or leave two accepted rows.
 */
export const saveMessageVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseMessageVersionInput)
  .handler(async ({ data, context }): Promise<MessageVersionDto> => {
    const { data: row, error } = await callWorkspaceRpc(
      context.supabase as unknown as RpcClient,
      {
        name: "create_chat_message_version",
        args: definedArgs({
          p_chat_id: data.chatId,
          p_message_id: data.messageId,
          p_content: data.content,
          p_original_content: data.originalContent,
          p_instruction: data.instruction,
          p_source: data.source,
          p_branch_id: data.branchId,
          p_selection_start: data.selectionStart,
          p_selection_end: data.selectionEnd,
          p_accept: data.accepted,
        }),
      },
      {
        name: "kova_record_message_version",
        args: definedArgs({
          p_chat_id: data.chatId,
          p_message_id: data.messageId,
          p_source: data.source,
          p_content: data.content,
          p_branch_id: data.branchId,
          p_instruction: data.instruction,
          p_original_content: data.originalContent,
          p_selection_start: data.selectionStart,
          p_selection_end: data.selectionEnd,
          p_accepted: data.accepted,
          p_max_versions: MAX_VERSIONS_PER_MESSAGE,
        }),
      },
    );
    if (error) throw rpcError(error.message);
    if (!row) throw new Error("That edit could not be saved. Please try again.");
    return toVersion(row as unknown as VersionRow);
  });

export const acceptMessageVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { versionId: string }) => ({
    versionId: parseUuid(input?.versionId, "version"),
  }))
  .handler(async ({ data, context }): Promise<MessageVersionDto> => {
    const { data: row, error } = await callWorkspaceRpc(
      context.supabase as unknown as RpcClient,
      { name: "accept_chat_message_version", args: { p_version_id: data.versionId } },
      { name: "kova_accept_message_version", args: { p_version_id: data.versionId } },
    );
    if (error) throw rpcError(error.message);
    if (!row) throw new Error("That version no longer exists.");
    return toVersion(row as unknown as VersionRow);
  });

/* ------------------------------------------------------------------ *
 * Branches — durable chat tree with a single active branch per chat.
 * ------------------------------------------------------------------ */

export const listChatBranches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chatId: string }) => ({ chatId: parseChatId(input?.chatId) }))
  .handler(async ({ data, context }): Promise<ChatBranchDto[]> => {
    const { data: rows, error } = await context.supabase
      .from("chat_branches")
      .select(BRANCH_COLUMNS)
      .eq("owner_id", context.userId)
      .eq("chat_id", data.chatId)
      .order("created_at", { ascending: true })
      .limit(MAX_BRANCHES_PER_CHAT);
    if (error) throw dbError(error.message);
    return (rows ?? []).map((row) => toBranch(row as unknown as BranchRow));
  });

export const createChatBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseBranchInput)
  .handler(async ({ data, context }): Promise<ChatBranchDto> => {
    const { data: row, error } = await callWorkspaceRpc(
      context.supabase as unknown as RpcClient,
      {
        name: "create_chat_branch",
        args: definedArgs({
          p_chat_id: data.chatId,
          p_parent_branch_id: data.parentBranchId,
          p_branch_from_message_id: data.branchFromMessageId,
          p_branch_from_parent_message_id: data.branchFromParentMessageId,
          p_label: data.label,
          p_activate: data.active,
        }),
      },
      {
        name: "kova_create_chat_branch",
        args: definedArgs({
          p_chat_id: data.chatId,
          p_conversation_id: data.conversationId,
          p_parent_branch_id: data.parentBranchId,
          p_branch_from_parent_message_id: data.branchFromParentMessageId,
          p_branch_from_message_id: data.branchFromMessageId,
          p_branch_from_message_index: data.branchFromMessageIndex,
          p_message_ids: data.messageIds,
          p_label: data.label,
          p_activate: data.active,
          p_max_branches: MAX_BRANCHES_PER_CHAT,
        }),
      },
    );
    if (error) throw rpcError(error.message);
    if (!row) throw new Error("That branch could not be created. Please try again.");
    const branchRow = row as unknown as BranchRow;

    // The canonical RPC does not take a conversation mapping, so persist it on
    // the owner's own row afterwards. If that write is rejected the branch is
    // still real, and the caller keeps the conversation id it already knows.
    if (!branchRow.conversation_id) {
      const mapping = {
        conversation_id: data.conversationId,
        branch_from_message_index: data.branchFromMessageIndex,
        message_ids: data.messageIds,
      };
      const { data: mapped } = await context.supabase
        .from("chat_branches")
        // The generated types lag the production columns; the migration in this
        // release adds them, so the shape is checked by the schema contract test.
        .update(mapping as never)
        .eq("owner_id", context.userId)
        .eq("id", branchRow.id)
        .select(BRANCH_COLUMNS)
        .maybeSingle();
      if (mapped) return toBranch(mapped as unknown as BranchRow);
      return toBranch({ ...branchRow, conversation_id: data.conversationId });
    }
    return toBranch(branchRow);
  });

/** Deactivate-then-activate happens in one locked statement pair server-side. */
export const activateChatBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseBranchActivationInput)
  .handler(async ({ data, context }): Promise<ChatBranchDto> => {
    const { data: row, error } = await callWorkspaceRpc(
      context.supabase as unknown as RpcClient,
      { name: "activate_chat_branch", args: { p_branch_id: data.branchId } },
      {
        name: "kova_activate_chat_branch",
        args: { p_chat_id: data.chatId, p_branch_id: data.branchId },
      },
    );
    if (error) throw rpcError(error.message);
    if (!row) throw new Error("That branch no longer exists.");
    const activated = row as unknown as BranchRow;
    if (activated.chat_id !== data.chatId) throw new Error("That branch is not part of this chat.");
    return toBranch(activated);
  });

export const updateChatBranchMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { branchId: string; messageIds: string[]; label?: string }) => ({
    branchId: parseUuid(input?.branchId, "branch"),
    messageIds: parseMessageIds(input?.messageIds),
    label: input?.label ? String(input.label).slice(0, 120) : null,
  }))
  .handler(async ({ data, context }): Promise<ChatBranchDto> => {
    const { data: rows, error } = await context.supabase
      .from("chat_branches")
      .update({ message_ids: data.messageIds, label: data.label })
      .eq("owner_id", context.userId)
      .eq("id", data.branchId)
      .select(BRANCH_COLUMNS);
    if (error) throw dbError(error.message);
    const row = rows?.[0];
    if (!row) throw new Error("That branch no longer exists.");
    return toBranch(row as unknown as BranchRow);
  });

export const deleteChatBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseBranchActivationInput)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("chat_branches")
      .delete()
      .eq("owner_id", context.userId)
      .eq("chat_id", data.chatId)
      .eq("id", data.branchId)
      .select("id");
    if (error) throw dbError(error.message);
    if (!rows?.length) throw new Error("That branch no longer exists.");
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
      .select(RULES_COLUMNS)
      .eq("owner_id", context.userId)
      .eq("chat_id", data.chatId)
      .limit(1);
    if (error) throw dbError(error.message);
    const row = rows?.[0];
    if (!row) return null;
    return {
      id: row.id,
      chatId: row.chat_id,
      instructions: row.instructions,
      enabled: row.enabled,
      updatedAt: row.updated_at,
    };
  });

export const saveChatCustomRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseCustomRulesInput)
  .handler(async ({ data, context }): Promise<ChatCustomRulesDto> => {
    const { data: rpcRow, error: rpcFailure } = await callWorkspaceRpc(
      context.supabase as unknown as RpcClient,
      {
        name: "save_chat_custom_rules",
        args: {
          p_chat_id: data.chatId,
          p_instructions: data.instructions,
          p_enabled: data.enabled,
        },
      },
    );
    if (rpcFailure && !isMissingFunction(rpcFailure)) throw rpcError(rpcFailure.message);
    if (!rpcFailure && rpcRow) {
      const saved = rpcRow as unknown as {
        id: string;
        chat_id: string;
        instructions: string;
        enabled: boolean;
        updated_at: string;
      };
      return {
        id: saved.id,
        chatId: saved.chat_id,
        instructions: saved.instructions,
        enabled: saved.enabled,
        updatedAt: saved.updated_at,
      };
    }

    const { data: row, error } = await context.supabase
      .from("chat_custom_rules")
      .upsert(
        {
          owner_id: context.userId,
          chat_id: data.chatId,
          instructions: data.instructions,
          enabled: data.enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id,chat_id" },
      )
      .select(RULES_COLUMNS)
      .single();
    if (error) throw dbError(error.message);
    return {
      id: row.id,
      chatId: row.chat_id,
      instructions: row.instructions,
      enabled: row.enabled,
      updatedAt: row.updated_at,
    };
  });

export const setChatCustomRulesEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chatId: string; enabled: boolean }) => ({
    chatId: parseChatId(input?.chatId),
    enabled: input?.enabled === true,
  }))
  .handler(async ({ data, context }): Promise<ChatCustomRulesDto | null> => {
    const { data: rows, error } = await context.supabase
      .from("chat_custom_rules")
      .update({ enabled: data.enabled })
      .eq("owner_id", context.userId)
      .eq("chat_id", data.chatId)
      .select(RULES_COLUMNS);
    if (error) throw dbError(error.message);
    const row = rows?.[0];
    if (!row) return null;
    return {
      id: row.id,
      chatId: row.chat_id,
      instructions: row.instructions,
      enabled: row.enabled,
      updatedAt: row.updated_at,
    };
  });

export const resetChatCustomRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chatId: string }) => ({ chatId: parseChatId(input?.chatId) }))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("chat_custom_rules")
      .delete()
      .eq("owner_id", context.userId)
      .eq("chat_id", data.chatId)
      .select("id");
    if (error) throw dbError(error.message);
    if (!rows?.length) throw new Error("There were no saved rules for this chat.");
    return { ok: true as const };
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
      .select(PIN_COLUMNS)
      .eq("owner_id", context.userId)
      .eq("chat_id", data.chatId)
      .order("created_at", { ascending: true })
      .limit(MAX_PINS_PER_CHAT);
    if (error) throw dbError(error.message);
    return (rows ?? []).map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      sourceType: row.source_type as PinSourceType,
      sourceId: row.source_id,
      projectId: row.project_id,
      status: row.status as PinStatus,
      createdAt: row.created_at,
    }));
  });

export const pinChatFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parsePinInput)
  .handler(async ({ data, context }): Promise<ChatPinnedFileDto> => {
    const { count, error: countError } = await context.supabase
      .from("chat_pinned_files")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", context.userId)
      .eq("chat_id", data.chatId);
    if (countError) throw dbError(countError.message);
    if ((count ?? 0) >= MAX_PINS_PER_CHAT) {
      throw new Error(`You can pin up to ${MAX_PINS_PER_CHAT} files per chat.`);
    }

    // Ownership/visibility is proven again by RLS: the insert policy calls
    // kova_can_pin_source, so an unauthorized source id is rejected by Postgres.
    const { data: row, error } = await context.supabase
      .from("chat_pinned_files")
      .upsert(
        {
          owner_id: context.userId,
          chat_id: data.chatId,
          source_type: data.sourceType,
          source_id: data.sourceId,
          project_id: data.projectId,
          status: data.status,
        },
        { onConflict: "owner_id,chat_id,source_type,source_id" },
      )
      .select(PIN_COLUMNS)
      .single();
    if (error) {
      if (error.code === "42501") throw new Error("You do not have access to that file.");
      throw new Error(error.message);
    }
    return {
      id: row.id,
      chatId: row.chat_id,
      sourceType: row.source_type as PinSourceType,
      sourceId: row.source_id,
      projectId: row.project_id,
      status: row.status as PinStatus,
      createdAt: row.created_at,
    };
  });

export const setChatPinnedFileStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parsePinStatusInput)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("chat_pinned_files")
      .update({ status: data.status })
      .eq("owner_id", context.userId)
      .eq("chat_id", data.chatId)
      .eq("id", data.pinId)
      .select("id");
    if (error) throw dbError(error.message);
    if (!rows?.length) throw new Error("That pinned file no longer exists.");
    return { ok: true as const };
  });

export const unpinChatFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseUnpinInput)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("chat_pinned_files")
      .delete()
      .eq("owner_id", context.userId)
      .eq("chat_id", data.chatId)
      .eq("id", data.pinId)
      .select("id");
    if (error) throw dbError(error.message);
    if (!rows?.length) throw new Error("That pinned file no longer exists.");
    return { ok: true as const };
  });

/**
 * Resolve pinned files into bounded prompt context.
 *
 * Only metadata and already-extracted text are read — file bytes are never
 * duplicated. Sources the caller can no longer see are reported as
 * permission_lost/deleted and their pin status is corrected in place.
 */
export const resolvePinnedContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chatId: string; totalChars?: number }) => ({
    chatId: parseChatId(input?.chatId),
    totalChars:
      typeof input?.totalChars === "number" && input.totalChars > 0
        ? Math.min(Math.floor(input.totalChars), MAX_PINNED_CONTEXT_CHARS)
        : MAX_PINNED_CONTEXT_CHARS,
  }))
  .handler(async ({ data, context }): Promise<PinnedContextDto> => {
    const { describePinStatus } = await import("@/lib/chat-workspace-contract.mjs");

    const { data: pins, error } = await context.supabase
      .from("chat_pinned_files")
      .select(PIN_COLUMNS)
      .eq("owner_id", context.userId)
      .eq("chat_id", data.chatId)
      .order("created_at", { ascending: true })
      .limit(MAX_PINS_PER_CHAT);
    if (error) throw dbError(error.message);

    const resolved: {
      pinId: string;
      sourceType: PinSourceType;
      sourceId: string;
      projectId: string | null;
      status: PinStatus;
      name: string;
      content: string;
    }[] = [];

    for (const pin of pins ?? []) {
      const sourceType = pin.source_type as PinSourceType;
      const base = {
        pinId: pin.id,
        sourceType,
        sourceId: pin.source_id,
        projectId: pin.project_id,
      };

      if (sourceType === "library") {
        const { data: item } = await context.supabase
          .from("user_library_items")
          .select("id, title, content_text, file_name")
          .eq("user_id", context.userId)
          .eq("id", pin.source_id)
          .maybeSingle();
        if (!item) {
          resolved.push({ ...base, status: "deleted", name: "Removed item", content: "" });
          continue;
        }
        const text = item.content_text ?? "";
        resolved.push({
          ...base,
          status: text ? "active" : "indexing",
          name: item.title || item.file_name || "Library item",
          content: text,
        });
        continue;
      }

      // project_file: visibility is enforced by project_files RLS (membership).
      const { data: file } = await context.supabase
        .from("project_files")
        .select("id, name, project_id")
        .eq("project_id", pin.project_id ?? "")
        .eq("status", "ready")
        .eq("id", pin.source_id)
        .maybeSingle();
      if (!file) {
        const { data: project } = await context.supabase
          .from("projects")
          .select("id")
          .eq("id", pin.project_id ?? "")
          .maybeSingle();
        resolved.push({
          ...base,
          status: project ? "deleted" : "permission_lost",
          name: "Unavailable file",
          content: "",
        });
        continue;
      }

      const { data: chunks } = await context.supabase
        .from("project_file_chunks")
        .select("content, chunk_index")
        .eq("file_id", pin.source_id)
        .order("chunk_index", { ascending: true })
        .limit(20);
      const text = (chunks ?? []).map((chunk) => chunk.content).join("\n\n");
      resolved.push({
        ...base,
        status: text ? "active" : "indexing",
        name: file.name,
        content: text,
      });
    }

    // Persist corrected statuses so the UI can show the truth without recomputing.
    for (const item of resolved) {
      const previous = (pins ?? []).find((pin) => pin.id === item.pinId)?.status;
      if (previous && previous !== item.status) {
        await context.supabase
          .from("chat_pinned_files")
          .update({ status: item.status })
          .eq("owner_id", context.userId)
          .eq("id", item.pinId);
      }
    }

    const budgeted = budgetPinnedContext(resolved, {
      totalChars: data.totalChars,
      itemChars: MAX_PINNED_ITEM_CHARS,
      maxItems: MAX_PINS_PER_CHAT,
    });

    return {
      items: budgeted.items.map((item) => ({
        ...item,
        statusLabel: describePinStatus(item.status),
      })),
      usedChars: budgeted.usedChars,
      totalBudget: budgeted.totalBudget,
      truncatedCount: budgeted.truncatedCount,
      skippedCount: budgeted.skippedCount,
      truncated: budgeted.truncated,
    };
  });
