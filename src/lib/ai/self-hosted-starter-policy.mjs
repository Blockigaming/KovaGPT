import { consumerEffort } from "../consumer-effort-policy.mjs";

// Owner-approved temporary candidates. This module does not activate a route.
// Full original checkpoints remain the long-term destinations.
export const SELF_HOSTED_STARTER_MODELS = Object.freeze({
  "kova-argon-4.6": Object.freeze({
    repository: "Qwen/Qwen3.6-35B-A3B",
    upgradeRepository: "deepseek-ai/DeepSeek-V4-Flash-0731",
  }),
  "kova-neon-4.6": Object.freeze({
    repository: "nvidia/NVIDIA-Nemotron-3.5-Bolt-74B-A9B-24GB",
    upgradeRepository: "meta-llama/Llama-4-Maverick-17B-128E-Instruct",
  }),
  "kova-xenon-5": Object.freeze({
    repository: "Qwen/Qwen3.8-27B",
    upgradeRepository: "moonshotai/Kimi-K3",
  }),
});

/**
 * Runtime-native reasoning parameters must be supplied by a separately qualified
 * adapter, never inferred from a product alias or copied from OpenRouter.
 * Until then, Medium+ use bounded verification on the selected checkpoint.
 * This describes execution, not proof of quality, cost, or throughput.
 */
export function selfHostedStarterProfile(model, mode) {
  const foundation = Object.hasOwn(SELF_HOSTED_STARTER_MODELS, model)
    ? SELF_HOSTED_STARTER_MODELS[model]
    : null;
  const effort = consumerEffort(mode);
  if (!foundation || !effort) throw new Error("invalid_self_hosted_starter_profile");
  const reviews = effort.id === "instant" ? 0
    : effort.id === "ultra" ? 4
    : Math.min(4, effort.reviews + 1);
  return Object.freeze({
    ...foundation,
    model,
    ...effort,
    reviews,
    parallel: effort.id === "ultra",
    reviewerModel: model,
    reviewerToolsAllowed: false,
    nativeReasoningParameters: null,
    activationStatus: "requires_runtime_and_quality_qualification",
  });
}

/** Conservative reservation for every reviewer plus final synthesis.
 * Notes are limited by the executor to reviewTokens*8 UTF-8 bytes; reserve
 * bytes/2 tokens for each note. All reviews are metered, even on failure.
 */
export function selfHostedStarterBudget(model, mode, inputTokens) {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0)
    throw new Error("invalid_self_hosted_input_tokens");
  const p = selfHostedStarterProfile(model, mode);
  const noteTokens = p.reviewTokens * 4;
  const reviewInputs = p.reviews * (inputTokens + 512)
    + (p.parallel ? 0 : Math.max(0, p.reviews - 1) * noteTokens);
  const finalInput = inputTokens + p.reviews * noteTokens + (p.reviews ? 512 : 0);
  const input = reviewInputs + finalInput;
  const output = p.outputTokens + p.reviews * p.reviewTokens;
  if (!Number.isSafeInteger(input + output))
    throw new Error("self_hosted_budget_overflow");
  return Object.freeze({
    inputTokens: input,
    outputTokens: output,
    reservedTokens: input + output,
    providerCalls: 1 + p.reviews,
  });
}
