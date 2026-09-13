import {
  developerResponseInput,
  developerResponseFeatures,
} from "./developer-responses-policy.mjs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (code) => {
  throw new Error(code);
};
export const DEVELOPER_SCOPES = Object.freeze([
  "chat",
  "streaming",
  "image_generation",
  "embeddings",
  "files",
]);
export function developerUuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) fail("developer_id_invalid");
  return value;
}
export function parseDeveloperCredential(header) {
  const match = /^Bearer (kova_([0-9a-f-]{36})_([A-Za-z0-9_-]{43}))$/.exec(header ?? "");
  if (!match || !UUID.test(match[2])) fail("developer_unauthorized");
  return { token: match[1], keyId: match[2] };
}
export function developerRequestKey(value) {
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,128}$/.test(value))
    fail("developer_idempotency_key_required");
  return value;
}
export function parseDeveloperLimits(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("developer_limits_invalid");
  const keys = ["request", "daily", "monthly", "concurrent"];
  if (Object.keys(value).sort().join() !== keys.sort().join()) fail("developer_limits_invalid");
  for (const key of keys)
    if (!Number.isFinite(value[key]) || value[key] <= 0 || value[key] > 1e9)
      fail("developer_limits_invalid");
  if (
    !Number.isSafeInteger(value.concurrent) ||
    value.concurrent > 8 ||
    value.request > value.daily ||
    value.daily > value.monthly
  )
    fail("developer_limits_invalid");
  return { ...value };
}
export function parseDeveloperInput(kind, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("developer_input_invalid");
  const common = ["model"];
  const fields =
    kind === "responses"
      ? [
          "input",
          "instructions",
          "max_output_tokens",
          "stream",
          "tools",
          "tool_choice",
          "parallel_tool_calls",
          "text",
        ]
      : kind === "images"
        ? ["prompt", "n", "size", "quality"]
        : kind === "embeddings"
          ? ["input", "dimensions"]
          : fail("developer_operation_invalid");
  if (Object.keys(input).some((key) => ![...common, ...fields].includes(key)))
    fail("developer_field_invalid");
  if (typeof input.model !== "string" || !/^[a-z][a-z0-9-]{1,79}$/.test(input.model))
    fail("developer_model_invalid");
  const text = (value, max = 32000) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > max ||
      value.includes("\u0000")
    )
      fail("developer_text_invalid");
    return value;
  };
  const integer = (value, maximum) => {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      fail("developer_limit_invalid");
    return value;
  };
  const body = { model: input.model };
  let capability;
  if (kind === "responses") {
    body.input = developerResponseInput(input.input);
    Object.assign(body, developerResponseFeatures(input));
    if (input.instructions !== undefined) body.instructions = text(input.instructions, 8000);
    body.max_output_tokens = integer(input.max_output_tokens, 32768);
    if (input.stream !== undefined && typeof input.stream !== "boolean")
      fail("developer_stream_invalid");
    body.stream = input.stream === true;
    body.store = false;
    capability = body.stream ? "streaming" : "chat";
  } else if (kind === "images") {
    body.prompt = text(input.prompt, 16000);
    body.n = integer(input.n ?? 1, 4);
    if (typeof input.size !== "string" || !/^(auto|[0-9]{3,4}x[0-9]{3,4})$/.test(input.size))
      fail("developer_size_invalid");
    if (!["low", "medium", "high"].includes(input.quality)) fail("developer_quality_invalid");
    body.size = input.size;
    body.quality = input.quality;
    capability = "image_generation";
  } else {
    body.input = Array.isArray(input.input)
      ? input.input.map((value) => text(value, 8000))
      : text(input.input, 8000);
    if (Array.isArray(body.input) && (!body.input.length || body.input.length > 32))
      fail("developer_batch_invalid");
    if (input.dimensions !== undefined) body.dimensions = integer(input.dimensions, 4096);
    capability = "embeddings";
  }
  if (new TextEncoder().encode(JSON.stringify(body)).length > 65536)
    fail("developer_input_too_large");
  return { body, capability, publicModel: input.model };
}
