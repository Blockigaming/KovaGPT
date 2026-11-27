// Longest saved conversation (user + assistant messages) each plan can keep
// growing. Pro is the highest, Plus is in the middle, Free is the lowest. The
// stored-history policy still caps every plan at CHAT_HISTORY_LIMITS.messages.
export const CONVERSATION_MESSAGE_LIMITS = Object.freeze({
  free: 60,
  plus: 300,
  pro: 1000,
});

export function conversationMessageLimit(tier) {
  return CONVERSATION_MESSAGE_LIMITS[tier] ?? CONVERSATION_MESSAGE_LIMITS.free;
}

export function conversationLimitReached(tier, messageCount) {
  return Number.isFinite(messageCount) && messageCount >= conversationMessageLimit(tier);
}

export function conversationLimitMessage(tier) {
  const limit = conversationMessageLimit(tier);
  const upgrade = tier === "pro" ? "" : " Upgrade your plan for longer conversations, or";
  return `This conversation reached its ${limit}-message limit.${upgrade} Start a new chat to keep going.`;
}
