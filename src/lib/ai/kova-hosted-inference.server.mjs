/**
 * Optional Kova hosted text inference transport.
 * Fixed upstream destination, no caller-specified providers or URLs.
 * Never enable before provider billing, data-processing, model tool calling,
 * and production latency are validated.
 */
export const HOSTED_MODEL_MAP = Object.freeze({
  "kova-xenon-4.6": "moonshotai/kimi-k3",
  "kova-neon-4.6": "deepseek/deepseek-v4.1-flash-1017",
  "kova-argon-5": "qwen/qwen3.5-flash",
});

const HOSTED_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_REQUEST_BYTES = 256 * 1024;
const ALLOWED_KEYS = new Set([
  "model", "messages", "stream", "temperature", "top_p",
  "max_tokens", "max_completion_tokens", "tools", "tool_choice",
  "response_format", "parallel_tool_calls", "stop", "seed",
  "stream_options",
]);

export function isKovaHostedModelId(value) {
  return typeof value === "string" && Object.hasOwn(HOSTED_MODEL_MAP, value);
}

export function prepareKovaHostedRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !isKovaHostedModelId(value.model) ||
      Object.keys(value).some((key) => !ALLOWED_KEYS.has(key)) ||
      !Array.isArray(value.messages) || value.messages.length < 1 ||
      value.messages.length > 256)
    throw new Error("invalid_hosted_request");
  if (value.messages.some((message) =>
    !message || typeof message !== "object" || Array.isArray(message) ||
    !["system", "developer", "user", "assistant", "tool"].includes(message.role) ||
    (Array.isArray(message.content) && message.content.some((part) =>
      part?.type === "image_url" || part?.type === "input_image"
    ))))
    throw new Error("hosted_text_only");
  if (value.tools !== undefined && (!Array.isArray(value.tools) || value.tools.length > 64))
    throw new Error("invalid_hosted_tools");
  if (value.stream !== undefined && typeof value.stream !== "boolean")
    throw new Error("invalid_hosted_stream");
  const rawMax = value.max_completion_tokens ?? value.max_tokens ?? 2048;
  if (!Number.isSafeInteger(rawMax) || rawMax < 1 || rawMax > 4096)
    throw new Error("invalid_hosted_token_limit");
  if (value.max_tokens !== undefined && value.max_completion_tokens !== undefined &&
      value.max_tokens !== value.max_completion_tokens)
    throw new Error("conflicting_hosted_token_limit");
  const { model, max_completion_tokens, ...rest } = value;
  const body = JSON.stringify({
    ...rest,
    model: HOSTED_MODEL_MAP[model],
    max_tokens: rawMax,
  });
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES)
    throw new Error("hosted_request_too_large");
  return { endpoint: HOSTED_CHAT_URL, body, alias: model };
}

export async function requestKovaHostedChat({
  request,
  token,
  signal,
  fetchImpl = fetch,
} = {}) {
  if (typeof token !== "string" || token.trim().length < 16)
    throw new Error("hosted_api_key_unavailable");
  const prepared = prepareKovaHostedRequest(request);
  const timeoutSignal = AbortSignal.timeout(45_000);
  const boundedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  const response = await fetchImpl(prepared.endpoint, {
    method: "POST",
    redirect: "error",
    signal: boundedSignal,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://kovagpt.com",
      "X-Title": "KovaGPT",
    },
    body: prepared.body,
  });
  if (!response.ok || response.redirected) {
    try { await response.body?.cancel(); } catch { /* best effort */ }
    // Never leak provider-specific errors, private prompt contents or credentials.
    const error = new Error("kova_hosted_inference_unavailable");
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const type = response.headers.get("content-type")?.split(";", 1)[0].trim();
  if (type !== (request.stream === true ? "text/event-stream" : "application/json")) {
    try { await response.body?.cancel(); } catch { /* best effort */ }
    throw new Error("kova_hosted_response_invalid");
  }
  return response;
}
