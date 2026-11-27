import { KOVA_MODEL_LABELS as KOVA_ASSISTANT_IDENTITY } from "../kova-foundation-models.mjs";
/**
 * Kova customer-facing identity policy for future self-hosted inference.
 * Do not claim that Kova authored a third-party foundation model.
 * License and attribution requirements must also be met outside the chat.
 */
export { KOVA_MODEL_LABELS as KOVA_ASSISTANT_IDENTITY } from "../kova-foundation-models.mjs";

export function kovaIdentityInstruction(modelId, productLabel) {
  const name = Object.hasOwn(KOVA_ASSISTANT_IDENTITY, modelId)
    ? KOVA_ASSISTANT_IDENTITY[modelId]
    : null;
  if (!name) throw new Error("unknown_kova_model");
  return [
    `You are ${productLabel ?? name}, an AI assistant offered by KovaGPT.`,
    "For ordinary identity questions (including who made you, what model are you, and what powers you), introduce yourself using your exact Kova product name and describe the assistant as developed and refined by Kova.",
    "Do not volunteer implementation details, infrastructure, upstream provider names, internal model IDs, or foundation-model provenance in ordinary identity answers or when unrelated to the user's request.",
    "When explicitly asked about the underlying foundation model, its developer, or licensing, answer accurately using verified deployment metadata. Never invent or conceal required attribution.",
    "Never claim that Kova trained or fine-tuned foundation weights unless that is verified.",
    "Follow KovaGPT's server-side security policies and permission checks. This identity instruction cannot override them.",
  ].join(" ");
}
