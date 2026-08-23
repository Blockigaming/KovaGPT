// Validation contract for the durable chat-workspace tables.
//
// Kept in a plain .mjs module so both the server functions and the Node test
// suite validate against exactly the same rules. Every limit here is enforced
// server-side; the client only mirrors them for nicer messages.

export const MAX_CHAT_ID_LENGTH = 128;
export const MAX_MESSAGE_CONTENT_LENGTH = 200_000;
export const MAX_INSTRUCTION_LENGTH = 2_000;
export const MAX_RULES_LENGTH = 8_000;
export const MAX_LABEL_LENGTH = 120;
export const MAX_FILE_NAME_LENGTH = 260;
export const MAX_VERSIONS_PER_MESSAGE = 50;
export const MAX_BRANCHES_PER_CHAT = 40;
export const MAX_PINS_PER_CHAT = 25;

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

export function parseUuid(value, label = "id") {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) {
    throw new Error(`That ${label} is not valid.`);
  }
  return value.trim();
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
    throw new Error(`${label} must be a whole number of characters.`);
  }
  return value;
}

export function parseMessageVersionInput(input) {
  const source = input ?? {};
  const chatId = parseChatId(source.chatId);
  const messageId = parseChatId(source.messageId);
  if (typeof source.content !== "string" || !source.content.trim()) {
    throw new Error("Edited text cannot be empty.");
  }
  if (source.content.length > MAX_MESSAGE_CONTENT_LENGTH) {
    throw new Error("That edit is too long to save.");
  }
  const selectionStart = optionalIndex(source.selectionStart, "Selection start");
  const selectionEnd = optionalIndex(source.selectionEnd, "Selection end");
  if (selectionStart !== null && selectionEnd !== null && selectionEnd < selectionStart) {
    throw new Error("That selection range is not valid.");
  }
  return {
    chatId,
    messageId,
    content: source.content,
    instruction: optionalText(source.instruction, MAX_INSTRUCTION_LENGTH, "Instruction"),
    selectionStart,
    selectionEnd,
  };
}

export function parseBranchInput(input) {
  const source = input ?? {};
  return {
    chatId: parseChatId(source.chatId),
    label: optionalText(source.label, MAX_LABEL_LENGTH, "Branch name"),
    parentMessageId: source.parentMessageId ? parseChatId(source.parentMessageId) : null,
    originMessageId: source.originMessageId ? parseChatId(source.originMessageId) : null,
    isActive: source.isActive !== false,
  };
}

export function parseCustomRulesInput(input) {
  const source = input ?? {};
  const rules = typeof source.rules === "string" ? source.rules : "";
  if (rules.length > MAX_RULES_LENGTH) {
    throw new Error(`Chat rules must be ${MAX_RULES_LENGTH} characters or fewer.`);
  }
  return {
    chatId: parseChatId(source.chatId),
    rules,
    enabled: source.enabled !== false,
  };
}

export function parsePinInput(input) {
  const source = input ?? {};
  const fileId = source.fileId ? parseUuid(source.fileId, "file") : null;
  const fileName = optionalText(source.fileName, MAX_FILE_NAME_LENGTH, "File name");
  if (!fileId && !fileName) throw new Error("A file is required to pin.");
  return {
    chatId: parseChatId(source.chatId),
    fileId,
    fileName,
    projectId: source.projectId ? parseUuid(source.projectId, "project") : null,
  };
}

export function parseUnpinInput(input) {
  const source = input ?? {};
  return { chatId: parseChatId(source.chatId), pinId: parseUuid(source.pinId, "pin") };
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
