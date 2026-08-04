import { getAiProviderConfig, type JsonObject } from "@/lib/ai/provider.server";
import type { ModeId } from "@/lib/modes";
import { modelForPolicy, type ModelPolicy } from "@/lib/ai/model-catalog.server";

export type ProviderCapability =
  | "chat"
  | "stream"
  | "tools"
  | "structured_output"
  | "vision"
  | "image_generation"
  | "embeddings"
  | "search"
  | "deep_research"
  | "speech_to_text"
  | "text_to_speech";

export type ProviderErrorCode =
  | "PROVIDER_NOT_CONFIGURED"
  | "CAPABILITY_UNSUPPORTED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_PROVIDER_RESPONSE"
  | "SEARCH_UNAVAILABLE"
  | "RESEARCH_FAILED"
  | "EMBEDDING_UNAVAILABLE";

export type ProviderId = "openai_compatible" | "firecrawl" | "kova_orchestrator";
export type SpeedClass = "fast" | "balanced" | "deep" | "realtime";
export type CostClass = "low" | "standard" | "high";
export type ModelUse =
  | "normal_chat"
  | "advanced_chat"
  | "deep_research"
  | "image_generation"
  | "embedding"
  | "utility"
  | "speech";

export type ProviderModelDefinition = {
  providerId: ProviderId;
  modelId: string;
  displayName: string;
  capabilities: ProviderCapability[];
  intendedUse: ModelUse[];
  speedClass: SpeedClass;
  costClass: CostClass;
  contextWindowTokens?: number;
  fallbackAllowed: boolean;
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  structuredOutput: boolean;
};

export type ProviderSelection = {
  model: ProviderModelDefinition;
  requiredCapabilities: ProviderCapability[];
  fallbackFrom?: string;
  metadata: JsonObject;
};

export class KovaProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly capability?: ProviderCapability;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; capability?: ProviderCapability } = {},
  ) {
    super(message);
    this.name = "KovaProviderError";
    this.code = code;
    this.status = options.status ?? 500;
    this.retryable = options.retryable ?? false;
    this.capability = options.capability;
  }

  toSafeResponse() {
    return {
      error: this.message,
      code: this.code,
      retryable: this.retryable,
      ...(this.capability ? { capability: this.capability } : {}),
    };
  }
}

const capabilityAliases: Record<string, ProviderCapability> = {
  streaming: "stream",
  tool_calls: "tools",
  web_search: "search",
  reasoning: "structured_output",
  file_analysis: "vision",
  realtime_voice: "speech_to_text",
};

export function normalizeCapability(value: string): ProviderCapability | null {
  const normalized = capabilityAliases[value] ?? value;
  const all: ProviderCapability[] = [
    "chat",
    "stream",
    "tools",
    "structured_output",
    "vision",
    "image_generation",
    "embeddings",
    "search",
    "deep_research",
    "speech_to_text",
    "text_to_speech",
  ];
  return all.includes(normalized as ProviderCapability) ? (normalized as ProviderCapability) : null;
}

export function configuredProviderCapabilities(): ProviderCapability[] {
  const ai = getAiProviderConfig();
  const aiCapabilities = ai.capabilities
    .map((capability) => normalizeCapability(capability))
    .filter(Boolean) as ProviderCapability[];
  const optional: ProviderCapability[] = [];
  if (process.env.FIRECRAWL_API_KEY) optional.push("search", "deep_research");
  return Array.from(new Set([...aiCapabilities, ...optional]));
}

export function getProviderRegistry(): ProviderModelDefinition[] {
  const cfg = getAiProviderConfig();
  return [
    {
      providerId: "openai_compatible",
      modelId: cfg.fastModel,
      displayName: "Kova Fast",
      capabilities: ["chat", "stream", "tools", "structured_output"],
      intendedUse: ["normal_chat", "utility"],
      speedClass: "fast",
      costClass: "low",
      contextWindowTokens: 128_000,
      fallbackAllowed: true,
      streaming: true,
      tools: true,
      vision: false,
      structuredOutput: true,
    },
    {
      providerId: "openai_compatible",
      modelId: cfg.chatModel,
      displayName: "Kova Balanced",
      capabilities: ["chat", "stream", "tools", "structured_output", "vision"],
      intendedUse: ["normal_chat", "advanced_chat", "utility"],
      speedClass: "balanced",
      costClass: "standard",
      contextWindowTokens: 128_000,
      fallbackAllowed: true,
      streaming: true,
      tools: true,
      vision: true,
      structuredOutput: true,
    },
    {
      providerId: "openai_compatible",
      modelId: modelForPolicy("thinking").id,
      displayName: "Kova Thinking",
      capabilities: ["chat", "stream", "tools", "structured_output", "vision"],
      intendedUse: ["advanced_chat"],
      speedClass: "deep",
      costClass: "high",
      contextWindowTokens: 128_000,
      fallbackAllowed: false,
      streaming: true,
      tools: true,
      vision: true,
      structuredOutput: true,
    },
    {
      providerId: "openai_compatible",
      modelId: cfg.deepModel,
      displayName: "Kova Thinking",
      capabilities: ["chat", "stream", "tools", "structured_output", "vision", "deep_research"],
      intendedUse: ["advanced_chat", "deep_research"],
      speedClass: "deep",
      costClass: "high",
      contextWindowTokens: 128_000,
      fallbackAllowed: true,
      streaming: true,
      tools: true,
      vision: true,
      structuredOutput: true,
    },
    {
      providerId: "openai_compatible",
      modelId: cfg.imageModel,
      displayName: "Kova Image",
      capabilities: ["image_generation"],
      intendedUse: ["image_generation"],
      speedClass: "balanced",
      costClass: "high",
      fallbackAllowed: false,
      streaming: false,
      tools: false,
      vision: false,
      structuredOutput: false,
    },
    {
      providerId: "openai_compatible",
      modelId: cfg.embeddingModel,
      displayName: "Kova Embeddings",
      capabilities: ["embeddings"],
      intendedUse: ["embedding"],
      speedClass: "fast",
      costClass: "low",
      fallbackAllowed: true,
      streaming: false,
      tools: false,
      vision: false,
      structuredOutput: false,
    },
  ];
}

export function modelSupports(
  model: ProviderModelDefinition,
  capabilities: ProviderCapability[],
): boolean {
  return capabilities.every((capability) => model.capabilities.includes(capability));
}

export function selectModelForCapabilities(
  preferredModelId: string | undefined,
  requiredCapabilities: ProviderCapability[],
  intendedUse?: ModelUse,
): ProviderSelection {
  const cfg = getAiProviderConfig();
  if (!cfg.configured) {
    throw new KovaProviderError(
      "PROVIDER_NOT_CONFIGURED",
      "KovaGPT is temporarily unavailable. Please try again later.",
      { status: 503 },
    );
  }
  const registry = getProviderRegistry().filter(
    (model) => !intendedUse || model.intendedUse.includes(intendedUse),
  );
  const preferred = preferredModelId
    ? registry.find((model) => model.modelId === preferredModelId)
    : undefined;
  if (preferred && modelSupports(preferred, requiredCapabilities)) {
    return { model: preferred, requiredCapabilities, metadata: { fallback: false } };
  }
  const fallback = registry.find(
    (model) => model.fallbackAllowed && modelSupports(model, requiredCapabilities),
  );
  if (!fallback) {
    throw new KovaProviderError(
      "CAPABILITY_UNSUPPORTED",
      "This KovaGPT capability is unavailable.",
      {
        status: 501,
        capability: requiredCapabilities[0],
      },
    );
  }
  return {
    model: fallback,
    requiredCapabilities,
    fallbackFrom: preferred?.modelId,
    metadata: { fallback: Boolean(preferred), requiredCapabilities },
  };
}

export function selectModelForMode(
  mode: ModeId | "deep_research" | "image",
  options: { hasImages?: boolean; needsTools?: boolean; needsSearch?: boolean } = {},
): ProviderSelection {
  if (mode === "image")
    return selectModelForCapabilities(undefined, ["image_generation"], "image_generation");
  if (mode === "deep_research")
    return selectModelForCapabilities(
      undefined,
      ["chat", "stream", "deep_research"],
      "deep_research",
    );
  const required: ProviderCapability[] = ["chat", "stream"];
  if (options.needsTools) required.push("tools");
  if (options.hasImages) required.push("vision");
  if (options.needsSearch) required.push("search");
  const policy: ModelPolicy =
    mode === "instant"
      ? "instant"
      : mode === "thinking"
        ? "thinking"
        : ["high", "extra_high", "pro"].includes(mode)
          ? "deep"
          : "normal";
  const preferred = modelForPolicy(policy).id;
  return selectModelForCapabilities(
    preferred,
    required,
    ["thinking", "high", "extra_high", "pro"].includes(mode) ? "advanced_chat" : "normal_chat",
  );
}

export function mapProviderError(error: unknown): KovaProviderError {
  if (error instanceof KovaProviderError) return error;
  if (
    error instanceof Error &&
    error.name === "AiProviderError" &&
    "code" in error &&
    "status" in error &&
    "retryable" in error
  ) {
    const source = error as Error & {
      code: string;
      status: number;
      retryable: boolean;
    };
    const code: ProviderErrorCode =
      source.code === "provider_timeout"
        ? "PROVIDER_TIMEOUT"
        : source.code === "provider_rate_limited"
          ? "PROVIDER_RATE_LIMIT"
          : source.code === "provider_bad_response"
            ? "INVALID_PROVIDER_RESPONSE"
            : "PROVIDER_UNAVAILABLE";
    return new KovaProviderError(code, source.message, {
      status: source.status,
      retryable: source.retryable,
    });
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new KovaProviderError(
      "PROVIDER_TIMEOUT",
      "KovaGPT took too long to respond. Please try again.",
      {
        status: 504,
        retryable: true,
      },
    );
  }
  if (error instanceof Error && /rate/i.test(error.message)) {
    return new KovaProviderError(
      "PROVIDER_RATE_LIMIT",
      "KovaGPT is busy right now. Please try again shortly.",
      { status: 429, retryable: true },
    );
  }
  return new KovaProviderError(
    "PROVIDER_UNAVAILABLE",
    "KovaGPT is temporarily unavailable. Please try again later.",
    { status: 502, retryable: true },
  );
}
