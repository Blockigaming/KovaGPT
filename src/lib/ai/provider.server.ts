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
  | "missing_openai_api_key"
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_auth_failed"
  | "provider_unavailable"
  | "provider_bad_response"
  | "provider_network_error";

export type ProviderErrorEnvelope = {
  error: string;
  code: ProviderErrorCode;
  retryable: boolean;
  status: number;
};

export type ProviderModelKind = "fast" | "balanced" | "deep";

export type ProviderConfig = {
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

const DEFAULT_CHAT_MODEL = "gpt-4o-mini";
const DEFAULT_FAST_MODEL = "gpt-4o-mini";
const DEFAULT_DEEP_MODEL = "gpt-4o";
const DEFAULT_IMAGE_MODEL = "gpt-image-1";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_TIMEOUT_MS = 45_000;

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
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseTimeout(value: string | undefined): number {
  if (!value) return DEFAULT_TIMEOUT_MS;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(n, 5_000), 120_000);
}

function parseCapabilities(value: string | undefined): ProviderCapability[] {
  if (!value) return DEFAULT_CAPABILITIES;
  const allowed = new Set<ProviderCapability>(DEFAULT_CAPABILITIES.concat("web_search"));
  const configured = value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is ProviderCapability => allowed.has(item as ProviderCapability));
  return configured.length ? Array.from(new Set(configured)) : DEFAULT_CAPABILITIES;
}

function baseUrl() {
  return (env("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, "");
}

export function getAiProviderConfig(): ProviderConfig {
  return {
    baseUrl: baseUrl(),
    chatModel: env("KOVA_CHAT_MODEL") ?? DEFAULT_CHAT_MODEL,
    fastModel: env("KOVA_FAST_MODEL") ?? DEFAULT_FAST_MODEL,
    deepModel: env("KOVA_DEEP_MODEL") ?? DEFAULT_DEEP_MODEL,
    imageModel: env("KOVA_IMAGE_MODEL") ?? DEFAULT_IMAGE_MODEL,
    embeddingModel: env("KOVA_EMBEDDING_MODEL") ?? DEFAULT_EMBEDDING_MODEL,
    timeoutMs: parseTimeout(env("KOVA_AI_TIMEOUT_MS")),
    capabilities: parseCapabilities(env("KOVA_AI_CAPABILITIES")),
    configured: Boolean(env("OPENAI_API_KEY")),
  };
}

export function validateAiProviderConfig(): ProviderErrorEnvelope | null {
  if (env("OPENAI_API_KEY")) return null;
  return {
    error: "AI provider is not configured. Set OPENAI_API_KEY on the server.",
    code: "missing_openai_api_key",
    retryable: false,
    status: 500,
  };
}

export function providerCapabilities(): ProviderCapability[] {
  return getAiProviderConfig().capabilities;
}

export function supportsProviderCapability(capability: ProviderCapability): boolean {
  return providerCapabilities().includes(capability);
}

export function providerUnavailableEnvelope(
  capability?: ProviderCapability,
): ProviderErrorEnvelope | null {
  const configError = validateAiProviderConfig();
  if (configError) return configError;
  if (capability && !supportsProviderCapability(capability)) {
    return {
      error: `${capability.replace(/_/g, " ")} is not enabled for the configured AI provider.`,
      code: "provider_unavailable",
      retryable: false,
      status: 501,
    };
  }
  return null;
}

export function missingAiProviderResponse(fallback?: JsonObject): Response | null {
  const missing = validateAiProviderConfig();
  if (!missing) return null;
  if (fallback) return Response.json(fallback, { status: 200 });
  return Response.json(
    { error: missing.error, code: missing.code, retryable: missing.retryable },
    { status: missing.status },
  );
}

function headers() {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) throw new AiProviderError(validateAiProviderConfig()!);
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
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
  if (error instanceof DOMException && error.name === "AbortError") {
    return new AiProviderError({
      error: "AI provider request timed out. Please retry.",
      code: "provider_timeout",
      retryable: true,
      status: 504,
    });
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new AiProviderError({
      error: "AI provider request timed out. Please retry.",
      code: "provider_timeout",
      retryable: true,
      status: 504,
    });
  }
  return new AiProviderError({
    error: "AI provider network request failed. Please retry.",
    code: "provider_network_error",
    retryable: true,
    status: 502,
  });
}

export async function providerErrorFromResponse(response: Response): Promise<AiProviderError> {
  let providerMessage = "";
  const text = await response.text().catch(() => "");
  if (text) {
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string } | string;
        message?: string;
      };
      if (typeof parsed.error === "string") providerMessage = parsed.error;
      else if (typeof parsed.error?.message === "string") providerMessage = parsed.error.message;
      else if (typeof parsed.message === "string") providerMessage = parsed.message;
    } catch {
      providerMessage = text.slice(0, 300);
    }
  }

  if (response.status === 401 || response.status === 403) {
    return new AiProviderError({
      error: "AI provider authentication failed. Check the server provider credentials.",
      code: "provider_auth_failed",
      retryable: false,
      status: response.status,
    });
  }
  if (response.status === 429) {
    return new AiProviderError({
      error: "AI provider rate limit reached. Please retry shortly.",
      code: "provider_rate_limited",
      retryable: true,
      status: 429,
    });
  }
  if (response.status >= 500) {
    return new AiProviderError({
      error: "AI provider is temporarily unavailable. Please retry.",
      code: "provider_unavailable",
      retryable: true,
      status: response.status,
    });
  }
  return new AiProviderError({
    error: providerMessage || "AI provider returned an invalid response.",
    code: "provider_bad_response",
    retryable: false,
    status: response.status,
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
  const { signal, cleanup } = mergeSignals(init?.signal ?? undefined, config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      method: "POST",
      signal,
      headers: { ...headers(), ...Object.fromEntries(new Headers(init?.headers).entries()) },
      body: JSON.stringify(body),
    });
    return response;
  } catch (error) {
    throw normalizeProviderError(error);
  } finally {
    cleanup();
  }
}

export function providerErrorResponse(error: unknown, fallbackStatus = 502): Response {
  const normalized = normalizeProviderError(error);
  const envelope = normalized.toEnvelope();
  return Response.json(
    { error: envelope.error, code: envelope.code, retryable: envelope.retryable },
    { status: envelope.status || fallbackStatus },
  );
}

export async function chatCompletions(body: JsonObject, init?: RequestInit): Promise<Response> {
  return providerFetch("/chat/completions", "chat", body, init);
}

export async function streamingChatCompletions(
  body: JsonObject,
  init?: RequestInit,
): Promise<Response> {
  return providerFetch("/chat/completions", "streaming", { ...body, stream: true }, init);
}

export async function imageGenerations(body: JsonObject, init?: RequestInit): Promise<Response> {
  return providerFetch("/images/generations", "image_generation", body, init);
}

export async function embeddings(body: JsonObject, init?: RequestInit): Promise<Response> {
  return providerFetch("/embeddings", "embeddings", body, init);
}
