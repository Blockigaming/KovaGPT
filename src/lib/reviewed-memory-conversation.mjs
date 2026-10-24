import { canonicalChatHistory, normalizeChatHistory } from "./chat-history-policy.mjs";

export function sameReviewedMemoryConversation(left, right, ownerId) {
  try {
    return (
      canonicalChatHistory(normalizeChatHistory(left, ownerId)) ===
      canonicalChatHistory(normalizeChatHistory(right, ownerId))
    );
  } catch {
    return false;
  }
}
