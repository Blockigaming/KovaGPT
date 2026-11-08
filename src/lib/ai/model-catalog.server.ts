import { runtimeEnv } from "@/lib/runtime-env.server";

export const MODEL_CATALOG_VERSION = "2026-11-08";
export const MODEL_CATALOG_SOURCES = [
  "https://platform.openai.com/docs/models",
  "https://platform.openai.com/docs/pricing",
  "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
  "https://developers.openai.com/api/docs/models/gpt-5.6-terra",
  "https://developers.openai.com/api/docs/models/gpt-5.6-sol",
] as const;

export type ModelTier = "guest" | "free" | "plus" | "pro";
export type ModelPolicy = "instant" | "normal" | "thinking" | "deep" | "utility";

export type CatalogModel = {
  id: string;
  endpoint: "responses";
  reasoning: boolean;
  vision: boolean;
  tools: boolean;
  structuredOutput: boolean;
  maxOutputTokens: number;
  pricePerMillion: { input: number; cachedInput: number; output: number };
  tiers: readonly ModelTier[];
};

// Prices are USD per one million tokens. Updating models or prices requires a
// catalog version bump and review against MODEL_CATALOG_SOURCES.
export const OPENAI_TEXT_MODELS: readonly CatalogModel[] = [
  {
    id: "gpt-4.1-nano",
    endpoint: "responses",
    reasoning: false,
    vision: true,
    tools: true,
    structuredOutput: true,
    maxOutputTokens: 32_768,
    pricePerMillion: { input: 0.1, cachedInput: 0.025, output: 0.4 },
    tiers: ["guest", "free", "plus", "pro"],
  },
  {
    id: "gpt-4.1-mini",
    endpoint: "responses",
    reasoning: false,
    vision: true,
    tools: true,
    structuredOutput: true,
    maxOutputTokens: 32_768,
    pricePerMillion: { input: 0.4, cachedInput: 0.1, output: 1.6 },
    tiers: ["free", "plus", "pro"],
  },
  {
    id: "gpt-5-mini",
    endpoint: "responses",
    reasoning: true,
    vision: true,
    tools: true,
    structuredOutput: true,
    maxOutputTokens: 128_000,
    pricePerMillion: { input: 0.25, cachedInput: 0.025, output: 2 },
    tiers: ["plus", "pro"],
  },
  {
    id: "gpt-5",
    endpoint: "responses",
    reasoning: true,
    vision: true,
    tools: true,
    structuredOutput: true,
    maxOutputTokens: 128_000,
    pricePerMillion: { input: 1.25, cachedInput: 0.125, output: 10 },
    tiers: ["pro"],
  },
  {
    id: "gpt-5.6-luna",
    endpoint: "responses",
    reasoning: true,
    vision: true,
    tools: true,
    structuredOutput: true,
    maxOutputTokens: 128_000,
    pricePerMillion: { input: 0.2, cachedInput: 0.02, output: 1.2 },
    tiers: ["guest", "free", "plus", "pro"],
  },
  {
    id: "gpt-5.6-terra",
    endpoint: "responses",
    reasoning: true,
    vision: true,
    tools: true,
    structuredOutput: true,
    maxOutputTokens: 128_000,
    pricePerMillion: { input: 2, cachedInput: 0.2, output: 12 },
    tiers: ["free", "plus", "pro"],
  },
  {
    id: "gpt-5.6-sol",
    endpoint: "responses",
    reasoning: true,
    vision: true,
    tools: true,
    structuredOutput: true,
    maxOutputTokens: 128_000,
    pricePerMillion: { input: 4, cachedInput: 0.4, output: 20 },
    tiers: ["plus", "pro"],
  },
] as const;

/**
 * Staged hosted inference catalog. These are third-party foundation-model routing
 * aliases; they do not imply ownership of the base weights or quality parity.
 * Input ceilings include the 1.25x cache-write rate, USD per 1M tokens.
 * Sources: https://developers.openai.com/api/docs/models/gpt-6-luna
 * https://developers.openai.com/api/docs/models/gpt-6.1-terra
 * https://developers.openai.com/api/docs/models/gpt-6.1-sol
 * Operator must re-check live prices/availability before activation.
 */
export const KOVA_HOSTED_TEXT_MODELS: readonly CatalogModel[] = [
  {
    id: "kova-argon-4.6",
    endpoint: "responses", // Native OpenAI Responses, converted at the chat boundary.
    reasoning: true,
    vision: true,
    tools: true,
    structuredOutput: true,
    maxOutputTokens: 8_192,
    pricePerMillion: { input: 0.125, cachedInput: 0.01, output: 0.5 },
    tiers: ["guest", "free", "plus", "pro"],
  },
  {
    id: "kova-neon-4.6",
    endpoint: "responses",
    reasoning: true,
    vision: true,
    tools: true,
    structuredOutput: true,
    maxOutputTokens: 8_192,
    pricePerMillion: { input: 1.25, cachedInput: 0.05, output: 5 },
    tiers: ["plus", "pro"],
  },
  {
    id: "kova-xenon-5",
    endpoint: "responses",
    reasoning: true,
    vision: true,
    tools: true,
    structuredOutput: true,
    maxOutputTokens: 16_384,
    pricePerMillion: { input: 2.5, cachedInput: 0.1, output: 10 },
    tiers: ["plus", "pro"],
  },
  {
    id: "kova-argon-4.5",
    endpoint: "responses",
    reasoning: true,
    vision: true,
    tools: true,
    structuredOutput: true,
    maxOutputTokens: 16_384,
    pricePerMillion: { input: 0.25, cachedInput: 0.02, output: 1.2 },
    tiers: ["plus", "pro"],
  },
  {
    id: "kova-neon-4.5",
    endpoint: "responses",
    reasoning: true,
    vision: true,
    tools: true,
    structuredOutput: true,
    maxOutputTokens: 16_384,
    pricePerMillion: { input: 2.5, cachedInput: 0.2, output: 12 },
    tiers: ["plus", "pro"],
  },
  {
    id: "kova-xenon-4.6",
    endpoint: "responses",
    reasoning: true,
    vision: true,
    tools: true,
    structuredOutput: true,
    maxOutputTokens: 16_384,
    pricePerMillion: { input: 2.5, cachedInput: 0.2, output: 10 },
    tiers: ["plus", "pro"],
  },
  {
    id: "kova-xenon-6.1",
    endpoint: "responses",
    reasoning: true,
    vision: true,
    tools: true,
    structuredOutput: true,
    maxOutputTokens: 16_384,
    pricePerMillion: { input: 12.5, cachedInput: 1, output: 50 },
    tiers: ["plus", "pro"],
  },
] as const;

const policies: Record<
  ModelPolicy,
  { env: string; fallback: string; maxOutput: number; allowed: readonly string[] }
> = {
  instant: {
    env: "KOVA_INSTANT_MODEL",
    fallback: "gpt-5.6-luna",
    maxOutput: 1_200,
    allowed: ["gpt-4.1-nano", "gpt-5.6-luna"],
  },
  normal: {
    env: "KOVA_NORMAL_MODEL",
    fallback: "gpt-5.6-luna",
    maxOutput: 4_000,
    allowed: ["gpt-4.1-nano", "gpt-4.1-mini", "gpt-5.6-luna"],
  },
  thinking: {
    env: "KOVA_THINKING_MODEL",
    fallback: "gpt-5.6-terra",
    maxOutput: 8_000,
    allowed: ["gpt-5-mini", "gpt-5.6-terra"],
  },
  deep: {
    env: "KOVA_DEEP_MODEL",
    fallback: "gpt-5.6-sol",
    maxOutput: 16_000,
    allowed: ["gpt-5-mini", "gpt-5", "gpt-5.6-terra", "gpt-5.6-sol"],
  },
  utility: {
    env: "KOVA_UTILITY_MODEL",
    fallback: "gpt-5.6-luna",
    maxOutput: 800,
    allowed: ["gpt-4.1-nano", "gpt-5.6-luna"],
  },
};

export function modelForPolicy(policy: ModelPolicy): CatalogModel & { outputCeiling: number } {
  const definition = policies[policy];
  const id = runtimeEnv(definition.env) ?? definition.fallback;
  const model = OPENAI_TEXT_MODELS.find(
    (candidate) => candidate.id === id && definition.allowed.includes(candidate.id),
  );
  if (!model) throw new Error(`unsupported_ai_model:${definition.env}`);
  return { ...model, outputCeiling: Math.min(definition.maxOutput, model.maxOutputTokens) };
}

export function maximumServerOutputForModel(modelId: string): number {
  const configured = (Object.keys(policies) as ModelPolicy[])
    .map((policy) => modelForPolicy(policy))
    .filter((model) => model.id === modelId)
    .map((model) => model.outputCeiling);
  if (!configured.length) throw new Error("unsupported_ai_model:request");
  return Math.max(...configured);
}

function longContextRate(model: CatalogModel, inputTokens: number) {
  // Official >272K full-request rate for Sol/Terra; Luna keeps its standard rate.
  return inputTokens > 272_000 &&
    KOVA_HOSTED_TEXT_MODELS.some((item) => item.id === model.id) &&
    model.id !== "kova-argon-4.6"
    ? { input: 2, output: 1.5 }
    : { input: 1, output: 1 };
}

export function estimateMaximumCostUsd(
  model: CatalogModel,
  estimatedInputTokens: number,
  maximumOutputTokens: number,
): number {
  const rate = longContextRate(model, estimatedInputTokens);
  return (
    (estimatedInputTokens * model.pricePerMillion.input * rate.input +
      maximumOutputTokens * model.pricePerMillion.output * rate.output) /
    1_000_000
  );
}

export function actualCostUsd(
  model: CatalogModel,
  usage: { input: number; cachedInput: number; output: number },
): number {
  const uncached = Math.max(0, usage.input - usage.cachedInput);
  const rate = longContextRate(model, usage.input);
  return (
    (uncached * model.pricePerMillion.input * rate.input +
      usage.cachedInput * model.pricePerMillion.cachedInput * rate.input +
      usage.output * model.pricePerMillion.output * rate.output) /
    1_000_000
  );
}
