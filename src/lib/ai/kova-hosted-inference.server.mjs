import { HOSTED_MODEL_MAP, resolveKovaReasoningEffort } from "../kova-foundation-models.mjs";
import { kovaIdentityInstruction } from "./kova-identity-policy.mjs";
import { responsesStreamToChatStream } from "./responses-compat.server.mjs";
import { readResponseBytesBounded } from "../endpoint-reliability.mjs";
/**
 * Optional Kova hosted text inference transport.
 * Fixed upstream destination, no caller-specified providers or URLs.
 * Never enable before provider billing, data-processing, model tool calling,
 * and production latency are validated.
 */
export { HOSTED_MODEL_MAP } from "../kova-foundation-models.mjs";

export const HOSTED_CHAT_URL = "https://api.openai.com/v1/responses";
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
export const MODEL_OUTPUT_LIMITS = Object.freeze({
  "kova-argon-4.6": 8192,
  "kova-neon-4.6": 8192,
  "kova-xenon-5": 16384,
  "kova-argon-4.5": 16384,
  "kova-neon-4.5": 16384,
  "kova-xenon-4.6": 16384,
  "kova-xenon-6.1": 16384,
});
const ALLOWED_KEYS = new Set([
  "model",
  "messages",
  "stream",
  "temperature",
  "top_p",
  "max_tokens",
  "max_completion_tokens",
  "tools",
  "tool_choice",
  "response_format",
  "parallel_tool_calls",
  "stop",
  "seed",
  "stream_options",
  "reasoning",
]);

export function isKovaHostedModelId(value) {
  return typeof value === "string" && Object.hasOwn(HOSTED_MODEL_MAP, value);
}

export function prepareKovaHostedRequest(value, { effort: selectedEffort } = {}) {
  if (
    selectedEffort !== undefined &&
    !["none", "low", "medium", "high", "xhigh", "max"].includes(selectedEffort)
  )
    throw new Error("invalid_hosted_effort");
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !isKovaHostedModelId(value.model) ||
    Object.keys(value).some((key) => !ALLOWED_KEYS.has(key)) ||
    !Array.isArray(value.messages) ||
    value.messages.length < 1 ||
    value.messages.length > 256
  )
    throw new Error("invalid_hosted_request");
  if (
    value.messages.some(
      (message) =>
        !message ||
        typeof message !== "object" ||
        Array.isArray(message) ||
        !["system", "developer", "user", "assistant", "tool"].includes(message.role),
    )
  )
    throw new Error("invalid_hosted_messages");
  // No provider-side fetch of user-supplied URLs. Uploaded images must arrive
  // as bounded inline image data from Kova's authenticated attachment flow.
  let totalImages = 0;
  for (const message of value.messages) {
    if (!Array.isArray(message.content)) continue;
    if (message.content.length > 16) throw new Error("invalid_hosted_content");
    for (const part of message.content) {
      if (!part || typeof part !== "object" || Array.isArray(part))
        throw new Error("invalid_hosted_content");
      if (part.type === "text" && typeof part.text === "string") continue;
      const url = part.type === "image_url" ? part.image_url?.url : null;
      if (
        typeof url !== "string" ||
        !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url) ||
        url.length > 5_000_000 ||
        ++totalImages > 4
      )
        throw new Error("invalid_hosted_image");
    }
  }
  if (value.tools !== undefined && (!Array.isArray(value.tools) || value.tools.length > 64))
    throw new Error("invalid_hosted_tools");
  if (value.stream !== undefined && typeof value.stream !== "boolean")
    throw new Error("invalid_hosted_stream");
  const rawMax = value.max_completion_tokens ?? value.max_tokens ?? 2048;
  if (!Number.isSafeInteger(rawMax) || rawMax < 1 || rawMax > MODEL_OUTPUT_LIMITS[value.model])
    throw new Error("invalid_hosted_token_limit");
  if (
    value.max_tokens !== undefined &&
    value.max_completion_tokens !== undefined &&
    value.max_tokens !== value.max_completion_tokens
  )
    throw new Error("conflicting_hosted_token_limit");
  // Reasoning is server-resolved; never trust a caller's reasoning object.
  const effort = resolveKovaReasoningEffort(value.model, selectedEffort);
  const instructions = [
    kovaIdentityInstruction(value.model),
    `Verified configuration: underlying foundation ${HOSTED_MODEL_MAP[value.model]}, developed by OpenAI. Kova is the product provider, not the foundation trainer.`,
  ];
  const input = [];
  for (const message of value.messages) {
    if (["system", "developer"].includes(message.role)) {
      if (typeof message.content !== "string") throw new Error("invalid_hosted_messages");
      instructions.push(message.content);
      continue;
    }
    if (message.role === "tool") {
      if (typeof message.tool_call_id !== "string" || typeof message.content !== "string")
        throw new Error("invalid_hosted_tool_output");
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: message.content,
      });
      continue;
    }
    if (message.content)
      input.push({
        role: message.role,
        content: Array.isArray(message.content)
          ? message.content.map((part) =>
              part.type === "image_url"
                ? { type: "input_image", image_url: part.image_url.url }
                : {
                    type: message.role === "assistant" ? "output_text" : "input_text",
                    text: part.text,
                  },
            )
          : message.content,
      });
    if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls))
      throw new Error("invalid_hosted_tools");
    for (const call of message.tool_calls ?? []) {
      if (
        typeof call.id !== "string" ||
        typeof call.function?.name !== "string" ||
        typeof call.function?.arguments !== "string"
      )
        throw new Error("invalid_hosted_tools");
      input.push({
        type: "function_call",
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      });
    }
  }
  const payload = {
    model: HOSTED_MODEL_MAP[value.model],
    instructions: instructions.join("\n\n"),
    input,
    stream: value.stream === true,
    max_output_tokens: rawMax,
    reasoning: { effort },
    store: false,
    service_tier: "default",
  };
  if (value.tools)
    payload.tools = value.tools.map((tool) => {
      if (tool?.type !== "function" || typeof tool.function?.name !== "string")
        throw new Error("invalid_hosted_tools");
      return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters ?? {},
        strict: tool.function.strict ?? false,
      };
    });
  if (value.tool_choice !== undefined) {
    const choice = value.tool_choice;
    if (["auto", "none", "required"].includes(choice)) payload.tool_choice = choice;
    else if (choice?.type === "function" && typeof choice.function?.name === "string")
      payload.tool_choice = { type: "function", name: choice.function.name };
    else throw new Error("invalid_hosted_tools");
  }
  if (value.parallel_tool_calls !== undefined)
    payload.parallel_tool_calls = value.parallel_tool_calls;
  if (value.response_format?.type === "json_object")
    payload.text = { format: { type: "json_object" } };
  else if (value.response_format?.type === "json_schema")
    payload.text = { format: { type: "json_schema", ...value.response_format.json_schema } };
  else if (value.response_format !== undefined && value.response_format?.type !== "text")
    throw new Error("invalid_hosted_response_format");
  // Sampling controls are unsupported with reasoning. Do not forward old-provider options.
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES)
    throw new Error("hosted_request_too_large");
  return { endpoint: HOSTED_CHAT_URL, body, alias: value.model };
}

export async function requestKovaHostedChat({
  request,
  token,
  signal,
  fetchImpl = fetch,
  effort,
} = {}) {
  if (typeof token !== "string" || token.trim().length < 16)
    throw new Error("hosted_api_key_unavailable");
  const prepared = prepareKovaHostedRequest(request, { effort });
  const boundedSignal = AbortSignal.any([AbortSignal.timeout(90_000), ...(signal ? [signal] : [])]);
  boundedSignal.throwIfAborted();
  const response = await fetchImpl(prepared.endpoint, {
    method: "POST",
    redirect: "error",
    signal: boundedSignal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: prepared.body,
  });
  if (!response.ok || response.redirected) {
    try {
      await response.body?.cancel();
    } catch {
      /* best effort */
    }
    const error = new Error("kova_hosted_inference_unavailable");
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const type = response.headers.get("content-type")?.split(";", 1)[0].trim();
  if (type !== (request.stream === true ? "text/event-stream" : "application/json")) {
    try {
      await response.body?.cancel();
    } catch {
      /* best effort */
    }
    throw new Error("kova_hosted_response_invalid");
  }
  const expectedModel = HOSTED_MODEL_MAP[request.model];
  if (request.stream === true) return responsesStreamToChatStream(response, { expectedModel });
  const bytes = await readResponseBytesBounded(response, 8 * 1024 * 1024, {
    signal: boundedSignal,
    timeoutMs: 90_000,
  });
  const value = JSON.parse(new TextDecoder().decode(bytes));
  const lengthLimited =
    value.status === "incomplete" && value.incomplete_details?.reason === "max_output_tokens";
  if (
    value.error ||
    (!lengthLimited && value.status !== "completed") ||
    !matchesOpenAiModel(value.model, expectedModel)
  )
    throw new Error("kova_hosted_response_invalid");
  let content = "";
  const calls = [];
  for (const item of value.output ?? []) {
    if (item.type === "message")
      for (const part of item.content ?? []) {
        if (part.type === "output_text") content += part.text;
        if (part.type === "refusal") content += part.refusal;
      }
    if (item.type === "function_call")
      calls.push({
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      });
  }
  const usage = value.usage;
  return Response.json({
    model: expectedModel,
    choices: [
      {
        index: 0,
        finish_reason: lengthLimited ? "length" : calls.length ? "tool_calls" : "stop",
        message: {
          role: "assistant",
          content: content || null,
          ...(calls.length ? { tool_calls: calls } : {}),
        },
      },
    ],
    usage: usage
      ? {
          prompt_tokens: usage.input_tokens,
          completion_tokens: usage.output_tokens,
          total_tokens: usage.total_tokens,
          prompt_tokens_details: usage.input_tokens_details,
          completion_tokens_details: usage.output_tokens_details,
        }
      : undefined,
  });
}

export function matchesOpenAiModel(actual, expected) {
  return (
    actual === expected ||
    (typeof actual === "string" &&
      actual.startsWith(expected + "-") &&
      /^\d{4}-\d{2}-\d{2}$/.test(actual.slice(expected.length + 1)))
  );
}
