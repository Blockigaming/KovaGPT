import { runtimeEnv } from "@/lib/runtime-env.server";

import { responsesStreamToChatStream } from "@/lib/ai/responses-compat.server.mjs";
import { getAiRuntimeConfig } from "@/lib/ai/config.server";
import { maximumServerOutputForModel, modelForPolicy } from "@/lib/ai/model-catalog.server";

import { DEFAULT_MODELS } from "./model-config.mjs";


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
const LOVABLE_GATEWAY_BASE_URL = "https://ai.gateway.lovable.dev/v1";

/**
 * Kova buys inference through the managed AI gateway when a gateway key is
 * present, and only falls back to a direct provider account otherwise. The
 * gateway namespaces every model id, so catalog ids are translated here and
 * nowhere else.
 */
const GATEWAY_MODEL_IDS: Record<string, string> = {
  "gpt-5.6-luna": "openai/gpt-5.6-luna",
  "gpt-5.6-terra": "openai/gpt-5.6-terra",
  "gpt-5.6-sol": "openai/gpt-5.6-sol",
  "gpt-4.1-nano": "openai/gpt-5-nano",
  "gpt-4.1-mini": "openai/gpt-5-mini",
  "gpt-5-mini": "openai/gpt-5-mini",
  "gpt-5": "openai/gpt-5",
  "gpt-image-1": "openai/gpt-image-1-mini",
  "text-embedding-3-small": "openai/text-embedding-3-small",
  "text-embedding-3-large": "openai/text-embedding-3-large",
};

function usingGateway(): boolean {
  return Boolean(env("LOVABLE_API_KEY"));
}

export function providerBaseUrl(): string {
  return usingGateway() ? LOVABLE_GATEWAY_BASE_URL : OPENAI_API_BASE_URL;
}

/** Translates a catalog model id into the id the active provider accepts. */
export function providerModelId(modelId: string): string {
  if (!usingGateway()) return modelId;
  if (modelId.includes("/")) return modelId;
  return GATEWAY_MODEL_IDS[modelId] ?? "openai/gpt-5-mini";
}

function withProviderModel(body: JsonObject): JsonObject {
  if (typeof body.model !== "string") return body;
  return { ...body, model: providerModelId(body.model) };
}

// Model ids live in ONE place: src/lib/ai/model-config.mjs. This adapter only
// mirrors the logical roles so nothing in the repository hardcodes a model.
const OPENAI_MODELS = {
  chat: DEFAULT_MODELS.DEFAULT_CHAT,
  fast: DEFAULT_MODELS.UTILITY,
  deep: DEFAULT_MODELS.PREMIUM_REASONING,
  image: DEFAULT_MODELS.IMAGE_GENERATION,
  embedding: DEFAULT_MODELS.EMBEDDING,
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
  const allowed = new Set<ProviderCapability>(DEFAULT_CAPABILITIES.concat("web_search"));
  const configured = value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is ProviderCapability => allowed.has(item as ProviderCapability));
  return configured.length ? Array.from(new Set(configured)) : DEFAULT_CAPABILITIES;
}

export function getAiProviderConfig(): ProviderConfig {
  return {
    provider: "openai",
    baseUrl: providerBaseUrl(),
    chatModel: modelForPolicy("normal").id,
    fastModel: modelForPolicy("instant").id,
    deepModel: modelForPolicy("deep").id,
    imageModel: env("KOVA_IMAGE_MODEL") ?? "gpt-image-1",
    embeddingModel: env("KOVA_EMBEDDING_MODEL") ?? "text-embedding-3-small",
    timeoutMs: parseTimeout(env("KOVA_AI_TIMEOUT_MS")),
    capabilities: parseCapabilities(env("KOVA_AI_CAPABILITIES")),
    configured: Boolean(env("LOVABLE_API_KEY") ?? env("OPENAI_API_KEY")),
  };
}

export function validateAiProviderConfig(): ProviderErrorEnvelope | null {
  let generationEnabled: boolean;
  try {
    generationEnabled = getAiRuntimeConfig().generationEnabled;
  } catch {
    return {
      error: "KovaGPT is temporarily unavailable. Please try again later.",
      code: "provider_unavailable",
      retryable: false,
      status: 503,
    };
  }
  if (!generationEnabled) {
    return {
      error: "KovaGPT generation is temporarily disabled.",
      code: "provider_unavailable",
      retryable: false,
      status: 503,
    };
  }
  if (env("LOVABLE_API_KEY") || env("OPENAI_API_KEY")) return null;
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
      error: "This KovaGPT capability is unavailable.",
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
  const key = env("LOVABLE_API_KEY") ?? env("OPENAI_API_KEY");
  if (!key) throw new AiProviderError(validateAiProviderConfig()!);
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export function chatModel(kind: ProviderModelKind = "balanced") {
  const config = getAiProviderConfig();
  if (kind === "fast") return config.fastModel;
  if (kind === "deep") return config.deepModel;
  return config.chatModel;
}

export function utilityModel() {
  return modelForPolicy("utility").id;
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

export async function providerErrorFromResponse(response: Response): Promise<AiProviderError> {
  await response.body?.cancel().catch(() => undefined);

  if (response.status === 401 || response.status === 402 || response.status === 403) {
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
  const { signal, cleanup } = mergeSignals(init?.signal ?? undefined, config.timeoutMs);
  try {
    return await fetch(`${providerBaseUrl()}${path}`, {
      ...init,
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers).entries()),
        ...headers(),
      },
      body: JSON.stringify(withProviderModel(body)),
    });
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
    {
      error: envelope.error,
      code: envelope.code,
      category: PROVIDER_FAILURE_CATEGORY,
      retryable: envelope.retryable,
    },
    { status: envelope.status || fallbackStatus, headers: NO_STORE_HEADERS },
  );
}

export async function chatCompletions(body: JsonObject, init?: RequestInit): Promise<Response> {
  const stream = body.stream === true;
  const response = await providerFetch(
    "/responses",
    stream ? "streaming" : "chat",
    toResponsesRequest(body),
    init,
  );
  if (!response.ok) return response;
  return stream ? responsesStreamToChatStream(response) : responsesJsonToChatJson(response);
}

export async function streamingChatCompletions(
  body: JsonObject,
  init?: RequestInit,
): Promise<Response> {
  return chatCompletions({ ...body, stream: true }, init);
}

/**
 * Kova's browser protocol intentionally remains the established Chat Completions
 * SSE shape. This adapter is the only compatibility boundary: OpenAI receives a
 * Responses API request and provider events are translated before leaving the
 * server. Consequently no UI code knows the provider or its wire format.
 */
function toResponsesRequest(body: JsonObject): JsonObject {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const instructions: string[] = [];
  const input: unknown[] = [];
  for (const value of messages) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const message = value as Record<string, unknown>;
    if (message.role === "system") {
      if (typeof message.content === "string") instructions.push(message.content);
      continue;
    }
    if (message.role === "tool" && typeof message.tool_call_id === "string") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output:
          typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      });
      continue;
    }
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (message.content)
      input.push({ role: message.role, content: normalizeResponsesContent(message) });
    for (const rawCall of toolCalls) {
      if (!rawCall || typeof rawCall !== "object" || Array.isArray(rawCall)) continue;
      const call = rawCall as Record<string, unknown>;
      const fn = call.function as Record<string, unknown> | undefined;
      input.push({
        type: "function_call",
        call_id: call.id,
        name: fn?.name,
        arguments: fn?.arguments ?? "{}",
      });
    }
  }
  const request: JsonObject = {
    model: body.model,
    input,
    stream: body.stream === true,
  };
  const serverOutputCeiling = maximumServerOutputForModel(String(body.model ?? ""));
  if (instructions.length) request.instructions = instructions.join("\n\n");
  if (Array.isArray(body.tools)) request.tools = body.tools;
  if (body.tool_choice !== undefined) request.tool_choice = body.tool_choice;
  if (typeof body.max_tokens === "number")
    request.max_output_tokens = Math.min(body.max_tokens, serverOutputCeiling);
  if (typeof body.max_completion_tokens === "number")
    request.max_output_tokens = Math.min(body.max_completion_tokens, serverOutputCeiling);
  if (request.max_output_tokens === undefined) request.max_output_tokens = serverOutputCeiling;
  // Reasoning models default to medium effort, which makes ordinary chat slow
  // and expensive. Kova asks for low effort unless a caller opts into more.
  request.reasoning =
    body.reasoning && typeof body.reasoning === "object"
      ? body.reasoning
      : { effort: "low", summary: "auto" };
  request.store = false;
  return request;
}

function normalizeResponsesContent(message: Record<string, unknown>): unknown {
  if (!Array.isArray(message.content)) return message.content;
  return message.content.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const part = raw as Record<string, unknown>;
    if (part.type === "image_url") {
      const image = part.image_url as Record<string, unknown> | undefined;
      return { type: "input_image", image_url: image?.url };
    }
    if (part.type === "text") {
      return { type: message.role === "assistant" ? "output_text" : "input_text", text: part.text };
    }
    return part;
  });
}

function responseOutputToMessage(value: JsonObject): JsonObject {
  const output = Array.isArray(value.output) ? value.output : [];
  let content = "";
  const toolCalls: JsonObject[] = [];
  for (const raw of output) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part && typeof part === "object" && !Array.isArray(part)) {
          const text = (part as Record<string, unknown>).text;
          if (typeof text === "string") content += text;
        }
      }
    }
    if (item.type === "function_call") {
      toolCalls.push({
        id: typeof item.call_id === "string" ? item.call_id : item.id,
        type: "function",
        function: { name: item.name, arguments: item.arguments ?? "{}" },
      });
    }
  }
  return {
    role: "assistant",
    content: content || null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}

async function responsesJsonToChatJson(response: Response): Promise<Response> {
  const value = (await response.json()) as JsonObject;
  const message = responseOutputToMessage(value);
  const usage = value.usage as JsonObject | undefined;
  return Response.json(
    {
      id: value.id,
      model: value.model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: Array.isArray(message.tool_calls) ? "tool_calls" : "stop",
        },
      ],
      usage: usage
        ? {
            prompt_tokens: usage.input_tokens,
            completion_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens,
            input_tokens_details: usage.input_tokens_details,
            output_tokens_details: usage.output_tokens_details,
          }
        : undefined,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function imageGenerations(body: JsonObject, init?: RequestInit): Promise<Response> {
  return providerFetch("/images/generations", "image_generation", body, init);
}

export async function embeddings(body: JsonObject, init?: RequestInit): Promise<Response> {
  return providerFetch("/embeddings", "embeddings", body, init);
}
