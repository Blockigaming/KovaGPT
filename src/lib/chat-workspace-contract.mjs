// Validation contract for the durable chat-workspace tables.
//
// This mirrors the exact production schema: every table is owner-scoped
// (`owner_id`), rules live in `instructions`, message history is versioned with
// an explicit `source`, and pins reference a `source_type`/`source_id` pair.
//
// Kept as a plain .mjs module so the server functions and the Node test suite
// validate against exactly the same rules. Every limit here is also enforced by
// database CHECK constraints; the client only mirrors them for nicer messages.

export const MAX_CHAT_ID_LENGTH = 256;
export const MAX_MESSAGE_ID_LENGTH = 256;
export const MAX_MESSAGE_CONTENT_LENGTH = 131_072;
export const MAX_EDIT_INSTRUCTION_LENGTH = 4_000;
export const MAX_CONVERSATION_ID_LENGTH = 256;
export const MAX_RULES_LENGTH = 8_000;
export const MAX_LABEL_LENGTH = 120;
export const MAX_VERSIONS_PER_MESSAGE = 50;
export const MAX_BRANCHES_PER_CHAT = 40;
export const MAX_PINS_PER_CHAT = 25;
export const MAX_BRANCH_MESSAGE_IDS = 512;

// Exactly the values the database CHECK constraint allows.
export const MESSAGE_VERSION_SOURCES = Object.freeze([
  "original",
  "inline_edit",
  "retry",
  "branch_edit",
]);

export const PIN_SOURCE_TYPES = Object.freeze(["library", "project_file"]);

// `active` is the usable state; the rest are disclosure-only states.
export const PIN_STATUSES = Object.freeze([
  "active",
  "indexing",
  "failed",
  "permission_lost",
  "deleted",
]);

export const PIN_STATUS_AVAILABLE = "active";

/** Total characters of pinned-file content injected into one prompt. */
export const MAX_PINNED_CONTEXT_CHARS = 24_000;
/** Per-item ceiling so one large file cannot consume the whole budget. */
export const MAX_PINNED_ITEM_CHARS = 8_000;
/** Absolute ceiling a caller may request for the pinned-context budget. */
export const MAX_PINNED_CONTEXT_CHARS_LIMIT = 48_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Chat and message ids are opaque client strings, so validate shape only. */
export function parseChatId(value) {
  if (typeof value !== "string") throw new Error("A chat id is required.");
  const trimmed = value.trim();
  if (!trimmed) throw new Error("A chat id is required.");
  if (trimmed.length > MAX_CHAT_ID_LENGTH) throw new Error("That chat id is too long.");
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) throw new Error("That chat id is not valid.");
  return trimmed;
}

export function parseMessageId(value, label = "message id") {
  if (typeof value !== "string") throw new Error(`A ${label} is required.`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`A ${label} is required.`);
  if (trimmed.length > MAX_MESSAGE_ID_LENGTH) throw new Error(`That ${label} is too long.`);
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) throw new Error(`That ${label} is not valid.`);
  return trimmed;
}

/** Conversation ids map a branch row onto a real conversation in the chat store. */
export function parseConversationId(value) {
  if (typeof value !== "string") throw new Error("A conversation id is required.");
  const trimmed = value.trim();
  if (!trimmed) throw new Error("A conversation id is required.");
  if (trimmed.length > MAX_CONVERSATION_ID_LENGTH) {
    throw new Error("That conversation id is too long.");
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) throw new Error("That conversation id is not valid.");
  return trimmed;
}

export function parseUuid(value, label = "id") {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) {
    throw new Error(`That ${label} is not valid.`);
  }
  return value.trim();
}

function optionalUuid(value, label) {
  if (value === undefined || value === null || value === "") return null;
  return parseUuid(value, label);
}

function optionalText(value, max, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new Error(`${label} is too long.`);
  return trimmed;
}

function optionalIndex(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a whole number.`);
  }
  return value;
}

export function parseMessageVersionInput(input) {
  const source = input ?? {};
  const chatId = parseChatId(source.chatId);
  const messageId = parseMessageId(source.messageId);

  if (typeof source.source !== "string" || !MESSAGE_VERSION_SOURCES.includes(source.source)) {
    throw new Error("That version source is not valid.");
  }
  if (typeof source.content !== "string" || !source.content.trim()) {
    throw new Error("Edited text cannot be empty.");
  }
  if (source.content.length > MAX_MESSAGE_CONTENT_LENGTH) {
    throw new Error("That edit is too long to save.");
  }
  if (
    source.originalContent !== undefined &&
    source.originalContent !== null &&
    (typeof source.originalContent !== "string" ||
      source.originalContent.length > MAX_MESSAGE_CONTENT_LENGTH)
  ) {
    throw new Error("The original text is too long to save.");
  }

  const selectionStart = optionalIndex(source.selectionStart, "Selection start");
  const selectionEnd = optionalIndex(source.selectionEnd, "Selection end");
  if ((selectionStart === null) !== (selectionEnd === null)) {
    throw new Error("A selection needs both a start and an end.");
  }
  if (selectionStart !== null && selectionEnd !== null && selectionEnd < selectionStart) {
    throw new Error("That selection range is not valid.");
  }

  return {
    chatId,
    messageId,
    branchId: optionalUuid(source.branchId, "branch"),
    selectionStart,
    selectionEnd,
    source: source.source,
    instruction: optionalText(
      source.instruction ?? source.editInstruction,
      MAX_EDIT_INSTRUCTION_LENGTH,
      "Edit instruction",
    ),
    content: source.content,
    originalContent:
      source.originalContent === undefined || source.originalContent === null
        ? null
        : source.originalContent,
    accepted: source.accepted !== false,
  };
}

export function parseMessageIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Branch messages must be a list.");
  if (value.length > MAX_BRANCH_MESSAGE_IDS) throw new Error("That branch has too many messages.");
  return value.map((entry) => parseMessageId(entry, "branch message id"));
}

export function parseBranchInput(input) {
  const source = input ?? {};
  return {
    chatId: parseChatId(source.chatId),
    conversationId: parseConversationId(source.conversationId),
    parentBranchId: optionalUuid(source.parentBranchId, "parent branch"),
    branchFromParentMessageId: source.branchFromParentMessageId
      ? parseMessageId(source.branchFromParentMessageId, "message id")
      : null,
    branchFromMessageId: source.branchFromMessageId
      ? parseMessageId(source.branchFromMessageId, "message id")
      : null,
    branchFromMessageIndex: optionalIndex(source.branchFromMessageIndex, "Message index"),
    messageIds: parseMessageIds(source.messageIds),
    label: optionalText(source.label, MAX_LABEL_LENGTH, "Branch name"),
    active: source.active !== false,
  };
}

export function parseBranchActivationInput(input) {
  const source = input ?? {};
  return {
    chatId: parseChatId(source.chatId),
    branchId: parseUuid(source.branchId, "branch"),
  };
}

export function parseCustomRulesInput(input) {
  const source = input ?? {};
  const instructions = typeof source.instructions === "string" ? source.instructions : "";
  if (instructions.length > MAX_RULES_LENGTH) {
    throw new Error(`Chat instructions must be ${MAX_RULES_LENGTH} characters or fewer.`);
  }
  return {
    chatId: parseChatId(source.chatId),
    instructions,
    enabled: source.enabled !== false,
  };
}

export function parsePinInput(input) {
  const source = input ?? {};
  if (typeof source.sourceType !== "string" || !PIN_SOURCE_TYPES.includes(source.sourceType)) {
    throw new Error("That pin source type is not valid.");
  }
  const sourceId = parseUuid(source.sourceId, "source");
  const projectId = optionalUuid(source.projectId, "project");
  if (source.sourceType === "library" && projectId) {
    throw new Error("Library pins cannot belong to a project.");
  }
  if (source.sourceType === "project_file" && !projectId) {
    throw new Error("A project is required to pin a project file.");
  }
  const status =
    source.status === undefined || source.status === null ? PIN_STATUS_AVAILABLE : source.status;
  if (typeof status !== "string" || !PIN_STATUSES.includes(status)) {
    throw new Error("That pin status is not valid.");
  }
  return {
    chatId: parseChatId(source.chatId),
    sourceType: source.sourceType,
    sourceId,
    projectId,
    status,
  };
}

export function parsePinStatusInput(input) {
  const source = input ?? {};
  if (typeof source.status !== "string" || !PIN_STATUSES.includes(source.status)) {
    throw new Error("That pin status is not valid.");
  }
  return {
    chatId: parseChatId(source.chatId),
    pinId: parseUuid(source.pinId, "pin"),
    status: source.status,
  };
}

export function parseUnpinInput(input) {
  const source = input ?? {};
  return { chatId: parseChatId(source.chatId), pinId: parseUuid(source.pinId, "pin") };
}

/**
 * Clamp pinned-file content to a bounded prompt budget. Returns per-item
 * truncation flags plus totals so callers can disclose exactly what was cut.
 */
export function budgetPinnedContext(items, options = {}) {
  const totalBudget = Math.min(
    MAX_PINNED_CONTEXT_CHARS_LIMIT,
    Math.max(1, options.totalChars ?? MAX_PINNED_CONTEXT_CHARS),
  );
  const itemBudget = Math.max(1, options.itemChars ?? MAX_PINNED_ITEM_CHARS);
  const maxItems = Math.max(1, options.maxItems ?? MAX_PINS_PER_CHAT);

  const included = [];
  let usedChars = 0;
  let skipped = 0;
  let truncatedCount = 0;

  for (const item of items ?? []) {
    if (included.length >= maxItems) {
      skipped += 1;
      continue;
    }
    if (item.status !== PIN_STATUS_AVAILABLE || typeof item.content !== "string" || !item.content) {
      // Unavailable items are still disclosed, but carry no content.
      included.push({ ...item, content: "", truncated: false, includedChars: 0 });
      continue;
    }
    const remaining = totalBudget - usedChars;
    if (remaining <= 0) {
      skipped += 1;
      continue;
    }
    const limit = Math.min(itemBudget, remaining);
    const truncated = item.content.length > limit;
    const content = truncated ? item.content.slice(0, limit) : item.content;
    usedChars += content.length;
    if (truncated) truncatedCount += 1;
    included.push({ ...item, content, truncated, includedChars: content.length });
  }

  return {
    items: included,
    usedChars,
    totalBudget,
    truncatedCount,
    skippedCount: skipped,
    truncated: truncatedCount > 0 || skipped > 0,
  };
}

export function describePinStatus(status) {
  switch (status) {
    case "active":
      return "available";
    case "indexing":
      return "still being processed";
    case "failed":
      return "could not be read";
    case "deleted":
      return "no longer exists";
    case "permission_lost":
      return "no longer accessible to you";
    default:
      return "in an unknown state";
  }
}

/**
 * Precedence for prompt assembly: global custom instructions, then project
 * instructions, then per-chat rules. Later entries win on conflict because the
 * narrowest scope is the most recent explicit user intent.
 */
export function composeInstructionLayers({ global, project, chat } = {}) {
  const layers = [];
  const push = (scope, text) => {
    if (typeof text !== "string") return;
    const trimmed = text.trim();
    if (trimmed) layers.push({ scope, text: trimmed });
  };
  push("global", global);
  push("project", project);
  push("chat", chat);
  return layers;
}

export function renderInstructionLayers(layers) {
  if (!layers.length) return "";
  const headings = {
    global: "User's global custom instructions",
    project: "Project instructions",
    chat: "Rules for this chat (highest priority)",
  };
  return layers.map((layer) => `${headings[layer.scope]}:\n${layer.text}`).join("\n\n");
}
