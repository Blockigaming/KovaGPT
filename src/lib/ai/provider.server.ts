export type JsonObject = Record<string, unknown>;

const DEFAULT_CHAT_MODEL = "gpt-4o-mini";
const DEFAULT_FAST_MODEL = "gpt-4o-mini";
const DEFAULT_DEEP_MODEL = "gpt-4o";
const DEFAULT_IMAGE_MODEL = "gpt-image-1";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export function missingAiProviderResponse(fallback?: JsonObject): Response | null {
  if (process.env.OPENAI_API_KEY) return null;
  const body = fallback ?? {
    error: "AI provider is not configured. Set OPENAI_API_KEY on the server.",
    code: "missing_openai_api_key",
  };
  return Response.json(body, { status: fallback ? 200 : 500 });
}

function baseUrl() {
  return (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
}

function headers() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

export function chatModel(kind: "fast" | "balanced" | "deep" = "balanced") {
  if (kind === "fast") return process.env.KOVA_FAST_MODEL ?? DEFAULT_FAST_MODEL;
  if (kind === "deep") return process.env.KOVA_DEEP_MODEL ?? DEFAULT_DEEP_MODEL;
  return process.env.KOVA_CHAT_MODEL ?? DEFAULT_CHAT_MODEL;
}

export function imageModel() {
  return process.env.KOVA_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;
}

export function embeddingModel() {
  return process.env.KOVA_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
}

export async function chatCompletions(body: JsonObject, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl()}/chat/completions`, {
    ...init,
    method: "POST",
    headers: { ...headers(), ...Object.fromEntries(new Headers(init?.headers).entries()) },
    body: JSON.stringify(body),
  });
}

export async function imageGenerations(body: JsonObject, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl()}/images/generations`, {
    ...init,
    method: "POST",
    headers: { ...headers(), ...Object.fromEntries(new Headers(init?.headers).entries()) },
    body: JSON.stringify(body),
  });
}

export async function embeddings(body: JsonObject, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl()}/embeddings`, {
    ...init,
    method: "POST",
    headers: { ...headers(), ...Object.fromEntries(new Headers(init?.headers).entries()) },
    body: JSON.stringify(body),
  });
}
