import { canonicalChatHistory, normalizeChatHistory } from "./chat-history-policy.mjs";

const KEYS = new Set([
  "operation",
  "chatId",
  "expectedRevision",
  "memoryEnabled",
  "temporary",
  "confirmed",
  "text",
]);
export function parseReviewedMemoryRequest(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !KEYS.has(key)) ||
    value.operation !== "save_reviewed_memory" ||
    value.memoryEnabled !== true ||
    value.temporary !== false ||
    value.confirmed !== true ||
    typeof value.chatId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,100}$/u.test(value.chatId) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 1 ||
    typeof value.text !== "string" ||
    !value.text.trim() ||
    value.text.length > 1500
  )
    throw new Error("Review the exact memory text and confirm before saving.");
  return value;
}

export function reviewedMemorySource(conversation, ownerId) {
  let normalized;
  try {
    normalized = normalizeChatHistory(conversation, ownerId);
  } catch {
    throw new Error("Only an existing non-temporary synced chat can save memory.");
  }
  if (normalized.id.length > 100) throw new Error("This chat cannot save account memory.");
  const eligible = normalized.messages.slice(normalized.memoryStartIndex ?? 0);
  if (eligible.length < 4)
    throw new Error(
      "This chat needs at least four non-temporary messages before memory can be saved.",
    );
  return {
    conversation: normalized,
    messageCount: Math.min(30, eligible.length),
    title: (eligible.find((message) => message.role === "user")?.content ?? "Saved chat")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 120),
  };
}

/** Read eligibility only; this never starts or retries cloud synchronization. */
export function syncedReviewedMemorySource(state, conversation, ownerId) {
  const source = reviewedMemorySource(conversation, ownerId);
  const record = state?.records?.[source.conversation.id];
  if (
    !state ||
    state.ownerId !== ownerId ||
    state.cleared ||
    !record ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 1 ||
    record.dirty ||
    record.migration ||
    record.request ||
    record.conflict ||
    !record.local ||
    record.localHash !== record.serverHash ||
    canonicalChatHistory(normalizeChatHistory(record.local, ownerId)) !==
      canonicalChatHistory(source.conversation)
  )
    throw new Error(
      "Memory is available only after this version of the chat is already synced. Nothing was saved or synced by this review.",
    );
  return { ...source, revision: record.revision };
}

export { sameReviewedMemoryConversation } from "./reviewed-memory-conversation.mjs";
