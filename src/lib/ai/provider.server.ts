import { runtimeEnv } from "@/lib/runtime-env.server";

export type JsonObject = Record<string, unknown>;

export type ProviderCapability =
  | "chat"
  | "streaming"
  | "reasoning"
  | "tool_calls"
  | "web_search"
  | "embeddings"
  | "image_generation"
  | "vision"
  | "file_analysis"
  | "speech_to_text"
  | "text_to_speech"
  | "realtime_voice";

export type ProviderErrorCode =
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_bad_response";

export type ProviderErrorEnvelope = {
  error: string;
  code: ProviderErrorCode;
  retryable: boolean;
  status: number;
};

export type ProviderModelKind = "fast" | "balanced" | "deep";

export type ProviderConfig = {
  provider: "openai";
  baseUrl: string;
  chatModel: string;
  fastModel: string;
  deepModel: string;
  imageModel: string;
  embeddingModel: string;
  timeoutMs: number;
  capabilities: ProviderCapability[];
  configured: boolean;
};

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

const OPENAI_MODELS = {
  chat: "gpt-4o-mini",
  fast: "gpt-4o-mini",
  deep: "gpt-4o",
  image: "gpt-image-1",
  embedding: "text-embedding-3-small",
};

const DEFAULT_TIMEOUT_MS = 45_000;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const PROVIDER_FAILURE_CATEGORY = "model_provider_failure";

const DEFAULT_CAPABILITIES: ProviderCapability[] = [
  "chat",
  "streaming",
  "reasoning",
  "tool_calls",
  "embeddings",
  "image_generation",
  "vision",
  "file_analysis",
];

export class AiProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(envelope: ProviderErrorEnvelope) {
    super(envelope.error);
    this.name = "AiProviderError";
    this.code = envelope.code;
    this.status = envelope.status;
    this.retryable = envelope.retryable;
  }

  toEnvelope(): ProviderErrorEnvelope {
    return {
      error: this.message,
      code: this.code,
      retryable: this.retryable,
      status: this.status,
    };
  }
}

function env(name: string): string | undefined {
  return runtimeEnv(name);
}

function parseTimeout(value: string | undefined): number {
  if (!value) return DEFAULT_TIMEOUT_MS;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(n, 5_000), 120_000);
}

function parseCapabilities(value: string | undefined): ProviderCapability[] {
  if (!value) return DEFAULT_CAPABILITIES;
  const allowed = new Set<ProviderCapability>(
    DEFAULT_CAPABILITIES.concat("web_search"),
  );
  const configured = value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is ProviderCapability =>
      allowed.has(item as ProviderCapability),
    );
  return configured.length
    ? Array.from(new Set(configured))
    : DEFAULT_CAPABILITIES;
}

export function getAiProviderConfig(): ProviderConfig {
  const defaults = OPENAI_MODELS;
  return {
    provider: "openai",
    baseUrl: OPENAI_API_BASE_URL,
    chatModel: env("KOVA_CHAT_MODEL") ?? defaults.chat,
    fastModel: env("KOVA_FAST_MODEL") ?? defaults.fast,
    deepModel: env("KOVA_DEEP_MODEL") ?? defaults.deep,
    imageModel: env("KOVA_IMAGE_MODEL") ?? defaults.image,
    embeddingModel: env("KOVA_EMBEDDING_MODEL") ?? defaults.embedding,
    timeoutMs: parseTimeout(env("KOVA_AI_TIMEOUT_MS")),
    capabilities: parseCapabilities(env("KOVA_AI_CAPABILITIES")),
    configured: Boolean(env("OPENAI_API_KEY")),
  };
}

export function validateAiProviderConfig(): ProviderErrorEnvelope | null {
  if (env("OPENAI_API_KEY")) return null;
  return {
    error: "KovaGPT is temporarily unavailable. Please try again later.",
    code: "provider_unavailable",
    retryable: false,
    status: 503,
  };
}

export function providerCapabilities(): ProviderCapability[] {
  return getAiProviderConfig().capabilities;
}

export function supportsProviderCapability(
  capability: ProviderCapability,
): boolean {
  return providerCapabilities().includes(capability);
}

export function providerUnavailableEnvelope(
  capability?: ProviderCapability,
): ProviderErrorEnvelope | null {
  const configError = validateAiProviderConfig();
  if (configError) return configError;
  if (capability && !supportsProviderCapability(capability)) {
    return {
      error: "This KovaGPT capability is unavailable.",
      code: "provider_unavailable",
      retryable: false,
      status: 501,
    };
  }
  return null;
}

export function missingAiProviderResponse(
  fallback?: JsonObject,
): Response | null {
  const missing = validateAiProviderConfig();
  if (!missing) return null;
  if (fallback) {
    return Response.json(fallback, { status: 200, headers: NO_STORE_HEADERS });
  }
  return Response.json(
    {
      error: missing.error,
      code: missing.code,
      category: PROVIDER_FAILURE_CATEGORY,
      retryable: missing.retryable,
    },
    { status: missing.status, headers: NO_STORE_HEADERS },
  );
}

function headers(): Record<string, string> {
  const openAiKey = env("OPENAI_API_KEY");
  if (!openAiKey) throw new AiProviderError(validateAiProviderConfig()!);
  return {
    Authorization: `Bearer ${openAiKey}`,
    "Content-Type": "application/json",
  };
}

export function chatModel(kind: ProviderModelKind = "balanced") {
  const config = getAiProviderConfig();
  if (kind === "fast") return config.fastModel;
  if (kind === "deep") return config.deepModel;
  return config.chatModel;
}

export function imageModel() {
  return getAiProviderConfig().imageModel;
}

export function embeddingModel() {
  return getAiProviderConfig().embeddingModel;
}

function normalizeProviderError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return new AiProviderError({
      error: "KovaGPT took too long to respond. Please try again.",
      code: "provider_timeout",
      retryable: true,
      status: 504,
    });
  }
  return new AiProviderError({
    error: "KovaGPT is temporarily unavailable. Please try again later.",
    code: "provider_unavailable",
    retryable: true,
    status: 502,
  });
}

export async function providerErrorFromResponse(
  response: Response,
): Promise<AiProviderError> {
  await response.body?.cancel().catch(() => undefined);

  if (
    response.status === 401 ||
    response.status === 402 ||
    response.status === 403
  ) {
    return new AiProviderError({
      error: "KovaGPT is temporarily unavailable. Please try again later.",
      code: "provider_unavailable",
      retryable: false,
      status: 503,
    });
  }
  if (response.status === 429) {
    return new AiProviderError({
      error: "KovaGPT is busy right now. Please try again shortly.",
      code: "provider_rate_limited",
      retryable: true,
      status: 429,
    });
  }
  if (response.status >= 500) {
    return new AiProviderError({
      error: "KovaGPT is temporarily unavailable. Please try again later.",
      code: "provider_unavailable",
      retryable: true,
      status: 503,
    });
  }
  return new AiProviderError({
    error: "KovaGPT couldn't complete that request. Please try again.",
    code: "provider_bad_response",
    retryable: false,
    status: 502,
  });
}

function mergeSignals(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    },
  };
}

async function providerFetch(
  path: string,
  capability: ProviderCapability,
  body: JsonObject,
  init?: RequestInit,
): Promise<Response> {
  const unavailable = providerUnavailableEnvelope(capability);
  if (unavailable) throw new AiProviderError(unavailable);

  const config = getAiProviderConfig();
  const { signal, cleanup } = mergeSignals(
    init?.signal ?? undefined,
    config.timeoutMs,
  );
  try {
    return await fetch(`${OPENAI_API_BASE_URL}${path}`, {
      ...init,
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers).entries()),
        ...headers(),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw normalizeProviderError(error);
  } finally {
    cleanup();
  }
}

export function providerErrorResponse(
  error: unknown,
  fallbackStatus = 502,
): Response {
  const normalized = normalizeProviderError(error);
  const envelope = normalized.toEnvelope();
  return Response.json(
    {
      error: envelope.error,
      code: envelope.code,
      category: PROVIDER_FAILURE_CATEGORY,
      retryable: envelope.retryable,
    },
    { status: envelope.status || fallbackStatus, headers: NO_STORE_HEADERS },
  );
}

export async function chatCompletions(
  body: JsonObject,
  init?: RequestInit,
): Promise<Response> {
  return providerFetch("/chat/completions", "chat", body, init);
}

export async function streamingChatCompletions(
  body: JsonObject,
  init?: RequestInit,
): Promise<Response> {
  return providerFetch(
    "/chat/completions",
    "streaming",
    { ...body, stream: true },
    init,
  );
}

export async function imageGenerations(
  body: JsonObject,
  init?: RequestInit,
): Promise<Response> {
  return providerFetch("/images/generations", "image_generation", body, init);
}

export async function embeddings(
  body: JsonObject,
  init?: RequestInit,
): Promise<Response> {
  return providerFetch("/embeddings", "embeddings", body, init);
}
