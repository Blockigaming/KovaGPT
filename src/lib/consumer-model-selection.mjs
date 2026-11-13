import { KOVA_MODEL_LABELS } from "./kova-foundation-models.mjs";

export const FREE_CHAT_MODEL_LABELS = Object.freeze({
  instant: "Argon 4.6 mini",
  thinking: "Argon 4.5",
});

/** Closed product choices. Provider IDs and endpoints never come from the client. */
export const CONSUMER_MODELS = Object.freeze([
  Object.freeze({
    id: "kova-argon-4.6",
    label: KOVA_MODEL_LABELS["kova-argon-4.6"],
    description: "Fast replies",
    role: "DEFAULT_CHAT",
    tiers: Object.freeze(["free", "plus", "pro"]),
    vision: true,
  }),
  Object.freeze({
    id: "kova-neon-4.6",
    label: KOVA_MODEL_LABELS["kova-neon-4.6"],
    description: "Balanced intelligence",
    role: "ADVANCED_REASONING",
    tiers: Object.freeze(["plus", "pro"]),
    vision: true,
  }),
  Object.freeze({
    id: "kova-xenon-5",
    label: KOVA_MODEL_LABELS["kova-xenon-5"],
    description: "Advanced reasoning",
    role: "PREMIUM_REASONING",
    tiers: Object.freeze(["plus", "pro"]),
    vision: true,
  }),
  Object.freeze({
    id: "kova-argon-4.5",
    label: KOVA_MODEL_LABELS["kova-argon-4.5"],
    description: "Previous generation",
    role: "DEFAULT_CHAT",
    routingBinding: "kova-argon-4.6",
    tiers: Object.freeze(["plus", "pro"]),
    vision: true,
  }),
  Object.freeze({
    id: "kova-neon-4.5",
    label: KOVA_MODEL_LABELS["kova-neon-4.5"],
    description: "Previous generation",
    role: "ADVANCED_REASONING",
    routingBinding: "kova-neon-4.6",
    tiers: Object.freeze(["plus", "pro"]),
    vision: true,
  }),
  Object.freeze({
    id: "kova-xenon-4.6",
    label: KOVA_MODEL_LABELS["kova-xenon-4.6"],
    description: "Previous generation",
    role: "PREMIUM_REASONING",
    routingBinding: "kova-xenon-5",
    tiers: Object.freeze(["plus", "pro"]),
    vision: true,
  }),
  Object.freeze({
    id: "kova-xenon-6.1",
    label: KOVA_MODEL_LABELS["kova-xenon-6.1"],
    description: "Most capable reasoning",
    role: "PREMIUM_REASONING",
    routingBinding: "kova-xenon-5",
    tiers: Object.freeze(["plus", "pro"]),
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
