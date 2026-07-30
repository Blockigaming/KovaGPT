import type { Conversation, Message } from "./chat-store";

export const DEVICE_EXPORT_VERSION = 1;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_CONVERSATIONS = 500;
const MAX_MESSAGES = 2_000;
const MAX_TEXT_LENGTH = 200_000;

export type DeviceDataExport = {
  format: "kovagpt-device-export";
  version: typeof DEVICE_EXPORT_VERSION;
  exportedAt: string;
  scope: "this-device";
  settings: unknown;
  conversations: Conversation[];
  archivedConversations: Conversation[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateMessage(value: unknown): value is Message {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.length > 200) return false;
  if (value.role !== "user" && value.role !== "assistant") return false;
  if (typeof value.content !== "string" || value.content.length > MAX_TEXT_LENGTH) return false;
  if (value.attachments !== undefined) {
    if (!Array.isArray(value.attachments) || value.attachments.length > 20) return false;
    for (const attachment of value.attachments) {
      if (!isRecord(attachment)) return false;
      if (attachment.kind === "image") {
        if (
          typeof attachment.dataUrl !== "string" ||
          !/^data:image\/(png|jpeg|webp|gif);base64,/.test(attachment.dataUrl)
        )
          return false;
      } else if (attachment.kind === "text_file") {
        if (typeof attachment.name !== "string" || attachment.name.length > 500) return false;
        if (typeof attachment.content !== "string" || attachment.content.length > 256 * 1024)
          return false;
      } else if (attachment.kind === "library_file") {
        if (typeof attachment.libraryItemId !== "string" || attachment.libraryItemId.length > 200)
          return false;
        if (typeof attachment.name !== "string" || attachment.name.length > 500) return false;
      } else return false;
    }
  }
  if (value.activities !== undefined && !Array.isArray(value.activities)) return false;
  if (value.pendingConfirms !== undefined && !Array.isArray(value.pendingConfirms)) return false;
  return true;
}

function validateConversation(value: unknown): value is Conversation {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !value.id || value.id.length > 200) return false;
  if (typeof value.title !== "string" || value.title.length > 500) return false;
  if (!Array.isArray(value.messages) || value.messages.length > MAX_MESSAGES) return false;
  if (!value.messages.every(validateMessage)) return false;
  if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) return false;
  if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)) return false;
  if (
    !(["instant", "medium", "thinking", "high", "extra_high", "pro"] as unknown[]).includes(
      value.mode,
    )
  )
    return false;
  return true;
}

function validateConversationList(value: unknown, label: string): Conversation[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  if (value.length > MAX_CONVERSATIONS) {
    throw new Error(`${label} contains more than ${MAX_CONVERSATIONS} chats.`);
  }
  if (!value.every(validateConversation)) throw new Error(`${label} contains an invalid chat.`);
  return value;
}

export function parseDeviceDataExport(text: string): DeviceDataExport {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new Error("The export is larger than the 10 MB import limit.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Choose a valid KovaGPT JSON export.");
  }
  if (!isRecord(value) || value.format !== "kovagpt-device-export") {
    throw new Error("This is not a KovaGPT device-data export.");
  }
  if (value.version !== DEVICE_EXPORT_VERSION) {
    throw new Error("This KovaGPT export version is not supported.");
  }
  return {
    format: "kovagpt-device-export",
    version: DEVICE_EXPORT_VERSION,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
    scope: "this-device",
    settings: isRecord(value.settings) ? value.settings : {},
    conversations: validateConversationList(value.conversations, "Active conversations"),
    archivedConversations: validateConversationList(
      value.archivedConversations,
      "Archived conversations",
    ),
  };
}

export function mergeConversations(
  current: Conversation[],
  imported: Conversation[],
): Conversation[] {
  const byId = new Map(current.map((conversation) => [conversation.id, conversation]));
  for (const conversation of imported) {
    const existing = byId.get(conversation.id);
    if (!existing || conversation.updatedAt > existing.updatedAt)
      byId.set(conversation.id, conversation);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
}
