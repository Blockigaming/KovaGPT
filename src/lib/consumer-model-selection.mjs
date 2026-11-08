/** Closed product choices. Provider IDs and endpoints never come from the client. */
export const CONSUMER_MODELS = Object.freeze([
  Object.freeze({
    id: "kova-argon-4.6",
    label: "Argon 4.6",
    description: "Fast replies",
    role: "DEFAULT_CHAT",
    tiers: Object.freeze(["free", "plus", "pro"]),
    vision: true,
  }),
  Object.freeze({
    id: "kova-neon-4.6",
    label: "Neon 4.6",
    description: "Balanced intelligence",
    role: "ADVANCED_REASONING",
    tiers: Object.freeze(["plus", "pro"]),
    vision: true,
  }),
  Object.freeze({
    id: "kova-xenon-5",
    label: "Xenon 5",
    description: "Highest intelligence",
    role: "PREMIUM_REASONING",
    tiers: Object.freeze(["pro"]),
    vision: true,
  }),
]);
export function consumerModel(value) {
  return typeof value === "string"
    ? (CONSUMER_MODELS.find((model) => model.id === value) ?? null)
    : null;
}

/** Keep transient selections scoped to their owning account and conversation. */
export function resolveConsumerModelChoice(choice, principal, conversationId, savedModel) {
  return choice?.principal === principal && choice.conversationId === conversationId
    ? choice.id
    : (savedModel ?? "kova-argon-4.6");
}
export function createConsumerModelChoice(id, tier, available, principal, conversationId) {
  return available && consumerModel(id)?.tiers.includes(tier)
    ? { principal, conversationId, id }
    : null;
}

/** Shared model-bound UI lookup; unfinished replies are never playback candidates. */
export function latestCompletedModelReply(messages) {
  return messages
    ?.filter(
      (message) =>
        message.role === "assistant" && !message.generationStatus && !message.pendingImage,
    )
    .at(-1);
}

/** Playback is available only for completed, receipted replies in saved chats. */
export function latestSavedModelReply(chat) {
  const message = latestCompletedModelReply(chat?.messages);
  return chat &&
    !chat.temporary &&
    message?.voiceModelReceipt &&
    message.id &&
    message.content.trim()
    ? { chatId: chat.id, messageId: message.id, content: message.content }
    : undefined;
}
