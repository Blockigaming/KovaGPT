import { runtimeEnv } from "@/lib/runtime-env.server";

export const MODEL_CATALOG_VERSION = "2026-08-03";
export const MODEL_CATALOG_SOURCES = [
  "https://platform.openai.com/docs/models",
  "https://platform.openai.com/docs/pricing",
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
] as const;

const policies: Record<
  ModelPolicy,
  { env: string; fallback: string; maxOutput: number; allowed: readonly string[] }
> = {
  instant: {
    env: "KOVA_INSTANT_MODEL",
    fallback: "gpt-4.1-nano",
    maxOutput: 600,
    allowed: ["gpt-4.1-nano"],
  },
  normal: {
    env: "KOVA_NORMAL_MODEL",
    fallback: "gpt-4.1-mini",
    maxOutput: 1_500,
    allowed: ["gpt-4.1-nano", "gpt-4.1-mini"],
  },
  thinking: {
    env: "KOVA_THINKING_MODEL",
    fallback: "gpt-5-mini",
    maxOutput: 3_000,
    allowed: ["gpt-5-mini"],
  },
  deep: {
    env: "KOVA_DEEP_MODEL",
    fallback: "gpt-5",
    maxOutput: 4_000,
    allowed: ["gpt-5-mini", "gpt-5"],
  },
  utility: {
    env: "KOVA_UTILITY_MODEL",
    fallback: "gpt-4.1-nano",
    maxOutput: 500,
    allowed: ["gpt-4.1-nano"],
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

export function estimateMaximumCostUsd(
  model: CatalogModel,
  estimatedInputTokens: number,
  maximumOutputTokens: number,
): number {
  return (
    (estimatedInputTokens * model.pricePerMillion.input +
      maximumOutputTokens * model.pricePerMillion.output) /
    1_000_000
  );
}

export function actualCostUsd(
  model: CatalogModel,
  usage: { input: number; cachedInput: number; output: number },
): number {
  const uncached = Math.max(0, usage.input - usage.cachedInput);
  return (
    (uncached * model.pricePerMillion.input +
      usage.cachedInput * model.pricePerMillion.cachedInput +
      usage.output * model.pricePerMillion.output) /
    1_000_000
  );
}
