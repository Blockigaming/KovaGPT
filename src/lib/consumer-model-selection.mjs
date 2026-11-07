/** Closed product choices. Provider IDs and endpoints never come from the client. */
export const CONSUMER_MODELS = Object.freeze([
  Object.freeze({
    id: "kova-argon-4.6",
    label: "Argon 4.6",
    description: "Fast replies",
    role: "DEFAULT_CHAT",
    tiers: Object.freeze(["free", "plus", "pro"]),
    vision: false,
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
