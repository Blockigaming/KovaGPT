import { runtimeEnv } from "@/lib/runtime-env.server";

import { responsesStreamToChatStream } from "@/lib/ai/responses-compat.server.mjs";
import { getAiRuntimeConfig } from "@/lib/ai/config.server";
import { maximumServerOutputForModel, modelForPolicy } from "@/lib/ai/model-catalog.server";

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
  | "file_analysis";

export type ProviderErrorCode =
  "provider_timeout" | "provider_rate_limited" | "provider_unavailable" | "provider_bad_response";

export type ProviderErrorEnvelope = {
  error: string;
  code: ProviderErrorCode;
  retryable: boolean;
  status: number;
};

export type ProviderModelKind = "fast" | "balanced" | "deep";
export type ProviderKind = "azure_openai" | "openai";

export type ProviderConfig = {
  provider: ProviderKind;
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

type ProviderTarget = {
  provider: ProviderKind;
  baseUrl: string;
  auth: "azure_api_key" | "azure_managed_identity" | "openai_api_key" | "missing";
};

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const AZURE_OPENAI_RESOURCE = "https://cognitiveservices.azure.com";
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

let managedIdentityToken:
  | {
      accessToken: string;
      expiresAtMs: number;
    }
  | undefined;
let managedIdentityRequest: Promise<string> | undefined;

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

function normalizeAzureOpenAiBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("invalid_azure_openai_endpoint");
  }

  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("invalid_azure_openai_endpoint");
  }

  const allowedHost =
    endpoint.hostname.endsWith(".openai.azure.com") ||
    endpoint.hostname.endsWith(".services.ai.azure.com") ||
    endpoint.hostname.endsWith(".cognitiveservices.azure.com");
  if (!allowedHost) throw new Error("invalid_azure_openai_endpoint");

  const pathname = endpoint.pathname.replace(/\/+$/u, "");
  if (pathname && pathname !== "/openai/v1") {
    throw new Error("invalid_azure_openai_endpoint");
  }

  return `${endpoint.origin}/openai/v1`;
}

function providerTarget(): ProviderTarget {
  const azureBaseUrl = normalizeAzureOpenAiBaseUrl(env("AZURE_OPENAI_ENDPOINT"));
  if (azureBaseUrl) {
    if (env("AZURE_OPENAI_API_KEY")) {
      return { provider: "azure_openai", baseUrl: azureBaseUrl, auth: "azure_api_key" };
    }
    if (env("IDENTITY_ENDPOINT") && env("IDENTITY_HEADER")) {
      return {
        provider: "azure_openai",
        baseUrl: azureBaseUrl,
        auth: "azure_managed_identity",
      };
    }
    return { provider: "azure_openai", baseUrl: azureBaseUrl, auth: "missing" };
  }

  return {
    provider: "openai",
    baseUrl: OPENAI_API_BASE_URL,
    auth: env("OPENAI_API_KEY") ? "openai_api_key" : "missing",
  };
}

export function providerBaseUrl(): string {
  return providerTarget().baseUrl;
}

function azureDeploymentForModel(modelId: string, capability?: ProviderCapability): string {
  if (capability === "image_generation") {
    return env("AZURE_OPENAI_DEPLOYMENT_IMAGE") ?? modelId;
  }
  if (capability === "embeddings") {
    return env("AZURE_OPENAI_DEPLOYMENT_EMBEDDING") ?? modelId;
  }

  const deepModel = modelForPolicy("deep").id;
  const thinkingModel = modelForPolicy("thinking").id;
  if (modelId === deepModel) return env("AZURE_OPENAI_DEPLOYMENT_DEEP") ?? modelId;
  if (modelId === thinkingModel) return env("AZURE_OPENAI_DEPLOYMENT_THINKING") ?? modelId;
  return env("AZURE_OPENAI_DEPLOYMENT_CHAT") ?? modelId;
}

export function providerModelId(modelId: string, capability?: ProviderCapability): string {
  return providerTarget().provider === "azure_openai"
    ? azureDeploymentForModel(modelId, capability)
    : modelId;
}

function withProviderModel(body: JsonObject, capability: ProviderCapability): JsonObject {
  if (typeof body.model !== "string") return body;
  return { ...body, model: providerModelId(body.model, capability) };
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
  const target = providerTarget();
  return {
    provider: target.provider,
    baseUrl: target.baseUrl,
    chatModel: modelForPolicy("normal").id,
    fastModel: modelForPolicy("instant").id,
    deepModel: modelForPolicy("deep").id,
    imageModel: env("KOVA_IMAGE_MODEL") ?? "gpt-image-1",
    embeddingModel: env("KOVA_EMBEDDING_MODEL") ?? "text-embedding-3-small",
    timeoutMs: parseTimeout(env("KOVA_AI_TIMEOUT_MS")),
    capabilities: parseCapabilities(env("KOVA_AI_CAPABILITIES")),
    configured: target.auth !== "missing",
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

  try {
    if (providerTarget().auth !== "missing") return null;
  } catch {
    // Invalid endpoints fail closed without exposing their value.
  }

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

function parseExpiry(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== "string" || !value.trim()) return Date.now() + 5 * 60_000;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now() + 5 * 60_000;
}

async function fetchManagedIdentityToken(): Promise<string> {
  if (managedIdentityToken && managedIdentityToken.expiresAtMs - Date.now() > 120_000) {
    return managedIdentityToken.accessToken;
  }
  if (managedIdentityRequest) return managedIdentityRequest;

  managedIdentityRequest = (async () => {
    const endpointValue = env("IDENTITY_ENDPOINT");
    const identityHeader = env("IDENTITY_HEADER");
    if (!endpointValue || !identityHeader) throw new Error("azure_managed_identity_unavailable");

    let endpoint: URL;
    try {
      endpoint = new URL(endpointValue);
    } catch {
      throw new Error("azure_managed_identity_unavailable");
    }
    if (endpoint.protocol !== "http:" || endpoint.username || endpoint.password) {
      throw new Error("azure_managed_identity_unavailable");
    }

    endpoint.searchParams.set("resource", AZURE_OPENAI_RESOURCE);
    endpoint.searchParams.set("api-version", "2019-08-01");
    const clientId = env("AZURE_CLIENT_ID");
    if (clientId) endpoint.searchParams.set("client_id", clientId);

    const response = await fetch(endpoint, {
      method: "GET",
      redirect: "error",
      headers: { "X-IDENTITY-HEADER": identityHeader },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("azure_managed_identity_unavailable");
    }

    const value = (await response.json()) as Record<string, unknown>;
    const accessToken = typeof value.access_token === "string" ? value.access_token : "";
    if (!accessToken) throw new Error("azure_managed_identity_unavailable");

    managedIdentityToken = {
      accessToken,
      expiresAtMs: parseExpiry(value.expires_on),
    };
    return accessToken;
  })();

  try {
    return await managedIdentityRequest;
  } finally {
    managedIdentityRequest = undefined;
  }
}

async function providerHeaders(): Promise<Record<string, string>> {
  const target = providerTarget();
  if (target.auth === "azure_api_key") {
    return {
      "api-key": env("AZURE_OPENAI_API_KEY")!,
      "Content-Type": "application/json",
    };
  }
  if (target.auth === "azure_managed_identity") {
    return {
      Authorization: `Bearer ${await fetchManagedIdentityToken()}`,
      "Content-Type": "application/json",
    };
  }
  if (target.auth === "openai_api_key") {
    return {
      Authorization: `Bearer ${env("OPENAI_API_KEY")!}`,
      "Content-Type": "application/json",
    };
  }
  throw new AiProviderError(validateAiProviderConfig()!);
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
    return await fetch(`${config.baseUrl}${path}`, {
      ...init,
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers).entries()),
        ...(await providerHeaders()),
      },
      body: JSON.stringify(withProviderModel(body, capability)),
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
