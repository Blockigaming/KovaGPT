import { normalizeMemorySources } from "./memory-sources.mjs";

export const CHAT_HISTORY_LIMITS = Object.freeze({
  snapshotBytes: 4 * 1024 * 1024,
  messages: 1000,
  chats: 1000,
  accountBytes: 50 * 1024 * 1024,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MODES = new Set([
  "instant",
  "medium",
  "thinking",
  "high",
  "extra_high",
  "pro",
  "kova_5_5",
  "kova_5_4",
  "kova_o3",
]);
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const text = (v, max) => typeof v === "string" && v.length <= max;
const time = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 8_640_000_000_000_000;
export function chatHistoryUuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("chat_history_invalid");
  return value.toLowerCase();
}
export function chatHistoryId(value) {
  if (
    !text(value, 200) ||
    !/^[A-Za-z0-9._:-]+$/u.test(value) ||
    ["__proto__", "prototype", "constructor"].includes(value)
  )
    throw new Error("chat_history_invalid");
  return value;
}
export function canonicalChatHistory(value) {
  return JSON.stringify(value, (_, v) =>
    object(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}
function attachment(value) {
  if (!object(value)) throw new Error("chat_history_invalid");
  if (
    value.kind === "image" &&
    text(value.dataUrl, CHAT_HISTORY_LIMITS.snapshotBytes) &&
    /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]*={0,2}$/u.test(value.dataUrl)
  )
    return { kind: "image", dataUrl: value.dataUrl };
  if (["text_file", "library_file"].includes(value.kind) && text(value.name, 500)) {
    const result = { kind: value.kind, name: value.name };
    if (value.kind === "text_file") {
      if (!text(value.content, 262144)) throw new Error("chat_history_invalid");
      result.content = value.content;
    } else result.libraryItemId = chatHistoryUuid(value.libraryItemId);
    if (value.fileType != null) {
      if (!text(value.fileType, 100)) throw new Error("chat_history_invalid");
      result.fileType = value.fileType;
    }
    if (value.size != null) {
      if (!Number.isSafeInteger(value.size) || value.size < 0)
        throw new Error("chat_history_invalid");
      result.size = value.size;
    }
    if (value.sourceProject != null) {
      if (!text(value.sourceProject, 500)) throw new Error("chat_history_invalid");
      result.sourceProject = value.sourceProject;
    }
    return result;
  }
  throw new Error("chat_history_invalid");
}

/** Canonical durable fields only. Temporary chats never enter the cloud outbox. */
export function normalizeChatHistory(value, ownerId) {
  if (
    !object(value) ||
    value.temporary === true ||
    !text(value.title, 500) ||
    !MODES.has(value.mode) ||
    !time(value.createdAt) ||
    !time(value.updatedAt) ||
    !Array.isArray(value.messages) ||
    value.messages.length > CHAT_HISTORY_LIMITS.messages
  )
    throw new Error("chat_history_invalid");
  const seen = new Set();
  const result = {
    id: chatHistoryId(value.id),
    title: value.title,
    mode: value.mode,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    messages: value.messages.map((message) => {
      if (
        !object(message) ||
        !text(message.content, 300000) ||
        !["user", "assistant"].includes(message.role)
      )
        throw new Error("chat_history_invalid");
      const id = chatHistoryId(message.id);
      if (seen.has(id)) throw new Error("chat_history_invalid");
      seen.add(id);
      const item = { id, role: message.role, content: message.content };
      if (message.attachments !== undefined) {
        if (!Array.isArray(message.attachments) || message.attachments.length > 20)
          throw new Error("chat_history_invalid");
        item.attachments = message.attachments.map(attachment);
      }
      const sources = normalizeMemorySources(message.memorySources, ownerId);
      if (sources && message.role === "assistant") item.memorySources = sources;
      // Pending image/tool activity is a request-local state, never completion evidence.
      if (Array.isArray(message.activities))
        item.activities = message.activities
          .filter(
            (v) => object(v) && v.status === "done" && text(v.tool, 100) && text(v.label, 200),
          )
          .slice(0, 30)
          .map(({ tool, label }) => ({ tool, label, status: "done" }));
      if (Array.isArray(message.pendingConfirms))
        item.pendingConfirms = message.pendingConfirms
          .filter(
            (v) =>
              object(v) &&
              UUID.test(v.actionId ?? "") &&
              text(v.tool, 100) &&
              text(v.summary, 1000) &&
              ["pending", "confirmed", "cancelled", "failed", "uncertain"].includes(v.status),
          )
          .slice(0, 20)
          .map((v) => ({
            actionId: v.actionId,
            tool: v.tool,
            summary: v.summary,
            status: v.status,
            argsPreview: object(v.argsPreview) ? v.argsPreview : {},
            ...(text(v.resultText, 12000) ? { resultText: v.resultText } : {}),
          }));
      return item;
    }),
  };
  if (value.kova !== undefined) {
    if (
      !object(value.kova) ||
      Object.keys(value.kova).some((k) => !["id", "versionId"].includes(k))
    )
      throw new Error("chat_history_invalid");
    result.kova = {
      id: chatHistoryUuid(value.kova.id),
      ...(value.kova.versionId !== undefined
        ? { versionId: chatHistoryUuid(value.kova.versionId) }
        : {}),
    };
  }
  if (value.pinned === true) result.pinned = true;
  if (time(value.pinnedAt)) result.pinnedAt = value.pinnedAt;
  if (value.memoryStartIndex !== undefined) {
    if (
      !Number.isSafeInteger(value.memoryStartIndex) ||
      value.memoryStartIndex < 0 ||
      value.memoryStartIndex > value.messages.length
    )
      throw new Error("chat_history_invalid");
    result.memoryStartIndex = value.memoryStartIndex;
  }
  if (value.branchRootId !== undefined) result.branchRootId = chatHistoryId(value.branchRootId);
  if (value.branchOrigin !== undefined) {
    if (!object(value.branchOrigin) || !text(value.branchOrigin.title, 500))
      throw new Error("chat_history_invalid");
    result.branchOrigin = {
      conversationId: chatHistoryId(value.branchOrigin.conversationId),
      messageId: chatHistoryId(value.branchOrigin.messageId),
      title: value.branchOrigin.title,
    };
  }
  if (
    new TextEncoder().encode(JSON.stringify(result)).byteLength > CHAT_HISTORY_LIMITS.snapshotBytes
  )
    throw new Error("chat_history_too_large");
  return result;
}
