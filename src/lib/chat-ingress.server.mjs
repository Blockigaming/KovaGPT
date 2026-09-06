import { BoundedJsonError, readBoundedJsonObject } from "./bounded-json.server.mjs";

export const CHAT_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
export const CHAT_MAX_MESSAGES = 100;
export const CHAT_MAX_MESSAGE_CHARS = 32 * 1024;
export const CHAT_MAX_ATTACHMENTS_PER_MESSAGE = 2;
export const CHAT_MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const CHAT_MAX_TEXT_ATTACHMENT_CHARS = 256 * 1024;
export const CHAT_MAX_ANON_BUCKETS = 4096;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SINGLE_LINE_PATTERN = /^[^\u0000-\u001f\u007f]*$/u;
const MULTILINE_PATTERN = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u;
const MIME_PATTERN = /^(?:text\/[a-z0-9!#$&^_.+-]+|application\/json)$/i;
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpe?g|webp|gif);base64,([a-z0-9+/]*={0,2})$/i;

const MODE_ALIASES = Object.freeze({
  default: "instant",
  fast: "instant",
  auto: "instant",
  creative: "thinking",
  precise: "thinking",
  code: "thinking",
  study: "medium",
  history: "medium",
  reason: "thinking",
  research: "thinking",
  writer: "thinking",
  tutor: "thinking",
});
const MODE_IDS = new Set([
  "instant",
  "medium",
  "thinking",
  "high",
  "extra_high",
  "pro",
  "kova_5_5",
  "kova_5_4",
  "kova_o3",
]);
const CLIENT_TOOLS = new Set([
  "web_search",
  "deep_research",
  "image",
  "study",
  "data_analysis",
  "file_analysis",
]);
const RESPONSE_LENGTHS = new Set(["short", "medium", "long"]);

const USER_STRING_LIMITS = Object.freeze({
  name: 200,
  pronouns: 100,
  email: 320,
  phone: 64,
  address: 1_000,
  extraFacts: 4_000,
  customInstructions: 8_000,
  mood: 100,
  language: 100,
});
const MULTILINE_USER_FIELDS = new Set(["extraFacts", "customInstructions"]);

export class ChatIngressError extends Error {
  constructor(code, status, publicMessage) {
    super(publicMessage);
    this.name = "ChatIngressError";
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

function invalid(code, publicMessage = "Invalid chat request.") {
  throw new ChatIngressError(code, 400, publicMessage);
}

function tooLarge(code, publicMessage) {
  throw new ChatIngressError(code, 413, publicMessage);
}

function isRecord(value) {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function errorField(field) {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function optionalTrimmedString(value, field, maxChars, { multiline = false } = {}) {
  if (value === undefined || value === null || value === "") return undefined;
  const code = `invalid_${errorField(field)}`;
  if (typeof value !== "string") invalid(code);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxChars) invalid(code, `${field} is too long.`);
  if (multiline ? !MULTILINE_PATTERN.test(normalized) : !SINGLE_LINE_PATTERN.test(normalized)) {
    invalid(code);
  }
  return normalized;
}

function optionalBoolean(value, field) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") invalid(`invalid_${errorField(field)}`);
  return value;
}

function optionalFiniteSize(value, field, max) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    invalid(`invalid_${errorField(field)}`);
  return value;
}

function optionalUuid(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !UUID_PATTERN.test(value))
    invalid(`invalid_${errorField(field)}`);
  return value.toLowerCase();
}

function normalizeMode(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") invalid("invalid_mode");
  if (MODE_IDS.has(value)) return value;
  const alias = MODE_ALIASES[value];
  if (alias) return alias;
  invalid("invalid_mode", "Invalid chat mode.");
}

function normalizeClientTool(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !CLIENT_TOOLS.has(value)) {
    invalid("invalid_client_tool", "Invalid chat tool.");
  }
  return value;
}

function normalizeTimezone(value) {
  const candidate = optionalTrimmedString(value, "timezone", 64);
  if (!candidate) return undefined;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: candidate,
    }).resolvedOptions().timeZone;
  } catch {
    invalid("invalid_timezone", "Invalid timezone.");
  }
}

function normalizeLocale(value) {
  const candidate = optionalTrimmedString(value, "locale", 64);
  if (!candidate) return undefined;
  try {
    return Intl.getCanonicalLocales(candidate)[0];
  } catch {
    invalid("invalid_locale", "Invalid locale.");
  }
}

function normalizeUser(value) {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) invalid("invalid_user", "Invalid user context.");

  const user = {};
  for (const [field, maxChars] of Object.entries(USER_STRING_LIMITS)) {
    const normalized = optionalTrimmedString(value[field], `user_${field}`, maxChars, {
      multiline: MULTILINE_USER_FIELDS.has(field),
    });
    if (normalized !== undefined) user[field] = normalized;
  }

  if (value.responseLength !== undefined && value.responseLength !== null) {
    if (typeof value.responseLength !== "string" || !RESPONSE_LENGTHS.has(value.responseLength)) {
      invalid("invalid_user_response_length", "Invalid response length.");
    }
    user.responseLength = value.responseLength;
  }

  for (const field of ["rememberAcross", "webSearch"]) {
    const normalized = optionalBoolean(value[field], `user_${field}`);
    if (normalized !== undefined) user[field] = normalized;
  }
  return user;
}

function normalizeFileType(value, field, { textOnly = false } = {}) {
  const normalized = optionalTrimmedString(value, field, 100);
  if (!normalized) return undefined;
  if (textOnly && !MIME_PATTERN.test(normalized)) invalid(`invalid_${errorField(field)}`);
  return normalized.toLowerCase();
}

function normalizeAttachment(value) {
  if (!isRecord(value) || typeof value.kind !== "string") invalid("invalid_attachment");

  if (value.kind === "image") {
    if (typeof value.dataUrl !== "string") invalid("invalid_image_attachment");
    const match = IMAGE_DATA_URL_PATTERN.exec(value.dataUrl);
    if (!match) invalid("invalid_image_attachment");
    const encoded = match[2];
    if (!encoded || encoded.length % 4 !== 0) invalid("invalid_image_attachment");
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const imageBytes = (encoded.length / 4) * 3 - padding;
    if (imageBytes > CHAT_MAX_IMAGE_BYTES) {
      tooLarge("image_attachment_too_large", "An image attachment exceeds the 3 MB limit.");
    }
    return { kind: "image", dataUrl: value.dataUrl };
  }

  if (value.kind === "text_file") {
    const name = optionalTrimmedString(value.name, "attachment_name", 255);
    if (!name) invalid("invalid_text_attachment", "Invalid text file attachment.");
    if (typeof value.content !== "string" || value.content.length === 0) {
      invalid("invalid_text_attachment", "Invalid text file attachment.");
    }
    if (value.content.length > CHAT_MAX_TEXT_ATTACHMENT_CHARS) {
      tooLarge("text_attachment_too_large", "A text attachment is too large.");
    }
    const result = { kind: "text_file", name, content: value.content };
    const fileType = normalizeFileType(value.fileType, "attachment_file_type", {
      textOnly: true,
    });
    const size = optionalFiniteSize(value.size, "attachment_size", CHAT_MAX_TEXT_ATTACHMENT_CHARS);
    if (fileType !== undefined) result.fileType = fileType;
    if (size !== undefined) result.size = size;
    return result;
  }

  if (value.kind === "library_file") {
    const libraryItemId = optionalUuid(value.libraryItemId, "library_item_id");
    const name = optionalTrimmedString(value.name, "attachment_name", 255);
    if (!libraryItemId || !name) invalid("invalid_library_attachment");
    const result = { kind: "library_file", libraryItemId, name };
    const fileType = normalizeFileType(value.fileType, "attachment_file_type");
    const size = optionalFiniteSize(value.size, "attachment_size", 512 * 1024 * 1024);
    const sourceProject = optionalTrimmedString(value.sourceProject, "source_project", 255);
    if (fileType !== undefined) result.fileType = fileType;
    if (size !== undefined) result.size = size;
    if (sourceProject !== undefined) result.sourceProject = sourceProject;
    return result;
  }

  invalid("invalid_attachment");
}

function normalizeMessage(value) {
  if (!isRecord(value) || (value.role !== "user" && value.role !== "assistant")) {
    invalid("invalid_message_role", "Each message must have a valid user or assistant role.");
  }
  if (typeof value.content !== "string") {
    invalid("invalid_message_content", "Each message must contain text content.");
  }
  if (value.content.length > CHAT_MAX_MESSAGE_CHARS) {
    tooLarge("message_too_large", "A message exceeds the maximum allowed length.");
  }

  const message = { role: value.role, content: value.content };
  if (value.attachments !== undefined && value.attachments !== null) {
    if (!Array.isArray(value.attachments)) invalid("invalid_attachments");
    if (value.attachments.length > CHAT_MAX_ATTACHMENTS_PER_MESSAGE) {
      invalid(
        "too_many_attachments",
        `A message can include at most ${CHAT_MAX_ATTACHMENTS_PER_MESSAGE} attachments.`,
      );
    }
    message.attachments = value.attachments.map(normalizeAttachment);
  }
  return message;
}

export function normalizeChatPayload(value) {
  if (!isRecord(value)) invalid("invalid_json", "Invalid request body.");
  if (!Array.isArray(value.messages) || value.messages.length === 0) {
    invalid("invalid_messages", "messages must be a non-empty array.");
  }
  if (value.messages.length > CHAT_MAX_MESSAGES) {
    tooLarge("too_many_messages", `Too many messages (max ${CHAT_MAX_MESSAGES}).`);
  }

  const messages = value.messages.map(normalizeMessage);
  const latestMessageIndex = messages.length - 1;
  const latestMessage = messages[latestMessageIndex];
  if (latestMessage.role !== "user") {
    invalid("invalid_message_sequence", "The final message must be from the user.");
  }
  if (
    !latestMessage.content.trim() &&
    (!latestMessage.attachments || latestMessage.attachments.length === 0)
  ) {
    invalid("empty_user_message", "The final user message cannot be empty.");
  }

  // Historical attachment bytes are client-controlled and cannot be proven to
  // have passed upload authorization in an earlier request. Reject instead of
  // silently stripping them so clients cannot believe forged history was used.
  if (
    messages.some(
      (message, index) =>
        index !== latestMessageIndex && message.attachments && message.attachments.length > 0,
    )
  ) {
    invalid(
      "historical_attachments_not_allowed",
      "Attachments are only allowed on the latest user message.",
    );
  }

  const payload = { messages };
  const mode = normalizeMode(value.mode);
  const user = normalizeUser(value.user);
  const timezone = normalizeTimezone(value.timezone);
  const locale = normalizeLocale(value.locale);
  const chatId = optionalUuid(value.chatId, "chat_id");
  const personality = optionalTrimmedString(value.personality, "personality", 500, {
    multiline: true,
  });
  const projectId = optionalUuid(value.projectId, "project_id");
  const temporary = optionalBoolean(value.temporary, "temporary");
  const clientTool = normalizeClientTool(value.clientTool);

  if (mode !== undefined) payload.mode = mode;
  if (user !== undefined) payload.user = user;
  if (timezone !== undefined) payload.timezone = timezone;
  if (locale !== undefined) payload.locale = locale;
  if (chatId !== undefined) payload.chatId = chatId;
  if (personality !== undefined) payload.personality = personality;
  if (projectId !== undefined) payload.projectId = projectId;
  if (temporary !== undefined) payload.temporary = temporary;
  if (clientTool !== undefined) payload.clientTool = clientTool;
  return payload;
}

function fromBoundedJsonError(error) {
  if (error.code === "request_too_large") {
    return new ChatIngressError("request_too_large", 413, "Request too large.");
  }
  return new ChatIngressError(error.code, 400, "Invalid request body.");
}

export async function readChatRequest(request, maxBytes = CHAT_BODY_LIMIT_BYTES, signal) {
  const mediaType = (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new ChatIngressError(
      "unsupported_media_type",
      415,
      "Content-Type must be application/json.",
    );
  }

  let value;
  try {
    value = await readBoundedJsonObject(request, maxBytes, signal);
  } catch (error) {
    if (error instanceof BoundedJsonError) throw fromBoundedJsonError(error);
    throw error;
  }
  return normalizeChatPayload(value);
}

export function toChatIngressErrorEnvelope(error, requestId, timestamp = new Date().toISOString()) {
  if (!(error instanceof ChatIngressError)) throw new TypeError("Expected ChatIngressError");
  return {
    error: error.publicMessage,
    code: error.code,
    category: "bad_request",
    requestId,
    retryable: false,
    timestamp,
  };
}

function normalizeIpv4(value) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return null;
  const octets = value.split(".");
  if (octets.some((part) => (part.length > 1 && part.startsWith("0")) || Number(part) > 255)) {
    return null;
  }
  return octets.map(Number).join(".");
}

function normalizeIpv6(value) {
  if (value.length > 45 || !value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) return null;
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    if (!hostname.startsWith("[") || !hostname.endsWith("]")) return null;
    return hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeIpAddress(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 45) return null;
  return normalizeIpv4(candidate) ?? normalizeIpv6(candidate);
}

export function resolveAnonymousClientKey(headers) {
  const connectingIp = normalizeIpAddress(headers.get("cf-connecting-ip"));
  // KovaGPT runs behind Cloudflare. Do not trust X-Forwarded-For directly: a
  // client can supply or prepend it and rotate arbitrary bucket keys.
  return connectingIp ? `ip:${connectingIp}` : "ip:unknown";
}

export function createAnonymousRateLimiter({
  maxRequests = 60,
  windowMs = 60 * 60 * 1000,
  maxBuckets = CHAT_MAX_ANON_BUCKETS,
} = {}) {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) {
    throw new TypeError("maxRequests must be a positive safe integer");
  }
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new TypeError("windowMs must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxBuckets) || maxBuckets < 2) {
    throw new TypeError("maxBuckets must be at least 2");
  }

  const buckets = new Map();
  const overflowKey = "ip:overflow";
  let checks = 0;

  const removeExpired = (now) => {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  };

  const isLimited = (requestedKey, now = Date.now()) => {
    if (!Number.isFinite(now)) throw new TypeError("now must be finite");
    checks += 1;
    if (checks % 64 === 0 || buckets.size >= maxBuckets - 1) removeExpired(now);

    let key = typeof requestedKey === "string" && requestedKey ? requestedKey : "ip:unknown";
    if (!buckets.has(key) && buckets.size >= maxBuckets - 1) key = overflowKey;

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }
    if (bucket.count >= maxRequests) return true;
    bucket.count += 1;
    return false;
  };

  return Object.freeze({
    isLimited,
    size: () => buckets.size,
    clear: () => buckets.clear(),
  });
}

export const chatAnonymousRateLimiter = createAnonymousRateLimiter();
