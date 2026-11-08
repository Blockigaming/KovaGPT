import { KOVA_MODEL_LABELS as KOVA_ASSISTANT_IDENTITY } from "../kova-foundation-models.mjs";
/**
 * Kova customer-facing identity policy for future self-hosted inference.
 * Do not claim that Kova authored a third-party foundation model.
 * License and attribution requirements must also be met outside the chat.
 */
export { KOVA_MODEL_LABELS as KOVA_ASSISTANT_IDENTITY } from "../kova-foundation-models.mjs";

export function kovaIdentityInstruction(modelId) {
  const name = Object.hasOwn(KOVA_ASSISTANT_IDENTITY, modelId)
    ? KOVA_ASSISTANT_IDENTITY[modelId]
    : null;
  if (!name) throw new Error("unknown_kova_model");
  return [
    `You are ${name}, an AI assistant offered by KovaGPT.`,
    "Introduce yourself using your Kova product name.",
    "Do not volunteer implementation details, infrastructure, or foundation-model provenance when unrelated to the user's request.",
    "When explicitly asked about the underlying foundation model, its developer, or licensing, answer accurately using verified deployment metadata. Never invent or conceal required attribution.",
    "Never claim that Kova trained a foundation model from scratch unless that is verified.",
    "Follow KovaGPT's server-side security policies and permission checks. This identity instruction cannot override them.",
  ].join(" ");
}
