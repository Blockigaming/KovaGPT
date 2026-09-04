export const MEMORY_LIMITS = Object.freeze({
  maxBodyBytes: 256 * 1024,
  maxMessages: 30,
  maxContentChars: 2_000,
  maxChatIdChars: 100,
  maxTitleChars: 120,
});

export class DurableBackendError extends Error {
  constructor(operation) {
    super(`${operation} failed`);
    this.name = "DurableBackendError";
    this.operation = operation;
  }
}

export class BodyReadError extends Error {
  constructor(status, code) {
    super(code);
    this.name = "BodyReadError";
    this.status = status;
    this.code = code;
  }
}

export async function readUtf8BodyBounded(request, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a nonnegative safe integer");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(contentLength)) {
      throw new BodyReadError(400, "invalid_content_length");
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes)) {
      throw new BodyReadError(400, "invalid_content_length");
    }
    if (declaredBytes > maxBytes) throw new BodyReadError(413, "request_too_large");
  }

  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new BodyReadError(400, "invalid_request_body");
      if (value.byteLength > maxBytes - totalBytes) {
        await reader.cancel("request_too_large").catch(() => undefined);
        throw new BodyReadError(413, "request_too_large");
      }
      totalBytes += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new BodyReadError(400, "invalid_utf8_body");
  }
}

async function cancelUnlockedBody(body, reason) {
  if (!body || typeof body.cancel !== "function") return;
  try {
    await body.cancel(reason);
  } catch {
    // The size/format error below remains authoritative if cancellation fails.
  }
}

/**
 * Reads an upstream response without allowing an unknown-length body to be
 * buffered beyond maxBytes. Declared overflows are rejected before a reader is
 * acquired; streamed overflows cancel the reader before chunks are assembled.
 */
export async function readResponseBytesBounded(response, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a nonnegative safe integer");
  }

  const contentLength = response.headers.get("content-length");
  let declaredBytes = null;
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      await cancelUnlockedBody(response.body, "invalid_content_length");
      throw new BodyReadError(502, "invalid_content_length");
    }
    declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes)) {
      await cancelUnlockedBody(response.body, "invalid_content_length");
      throw new BodyReadError(502, "invalid_content_length");
    }
    if (declaredBytes > maxBytes) {
      await cancelUnlockedBody(response.body, "response_too_large");
      throw new BodyReadError(413, "response_too_large");
    }
  }

  const contentEncoding = response.headers.get("content-encoding");
  const verifyDeclaredLength =
    declaredBytes !== null &&
    (!contentEncoding || contentEncoding.trim().toLowerCase() === "identity");

  if (!response.body) {
    if (verifyDeclaredLength && declaredBytes !== 0) {
      throw new BodyReadError(502, "content_length_mismatch");
    }
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        await reader.cancel("invalid_response_body").catch(() => undefined);
        throw new BodyReadError(502, "invalid_response_body");
      }
      if (value.byteLength > maxBytes - totalBytes) {
        await reader.cancel("response_too_large").catch(() => undefined);
        throw new BodyReadError(413, "response_too_large");
      }
      totalBytes += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (verifyDeclaredLength && totalBytes !== declaredBytes) {
    throw new BodyReadError(502, "content_length_mismatch");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function assertDatabaseSuccess(result, operation) {
  if (!result || result.error) throw new DurableBackendError(operation);
  return result.data;
}

export function parseMemoryPayload(raw) {
  if (typeof raw !== "string" || raw.length > MEMORY_LIMITS.maxBodyBytes) {
    return { ok: false, status: 413, error: "Request too large." };
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: "Invalid payload" };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Invalid payload" };
  }

  const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
  const title =
    body.title == null
      ? null
      : typeof body.title === "string"
        ? body.title.trim().slice(0, MEMORY_LIMITS.maxTitleChars)
        : null;
  if (
    !chatId ||
    chatId.length > MEMORY_LIMITS.maxChatIdChars ||
    (body.title != null && title === null) ||
    body.memoryEnabled !== true ||
    body.temporary !== false ||
    !Array.isArray(body.messages) ||
    body.messages.length < 4 ||
    body.messages.length > MEMORY_LIMITS.maxMessages
  ) {
    return { ok: false, status: 400, error: "Invalid payload" };
  }

  const messages = [];
  for (const item of body.messages) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, status: 400, error: "Invalid message payload" };
    }
    if (item.role !== "user" && item.role !== "assistant") {
      return { ok: false, status: 400, error: "Invalid message role" };
    }
    if (typeof item.content !== "string" || !item.content.trim()) {
      return { ok: false, status: 400, error: "Invalid message content" };
    }
    messages.push({
      role: item.role,
      content: item.content.slice(0, MEMORY_LIMITS.maxContentChars),
    });
  }

  return { ok: true, value: { chatId, title: title || null, messages } };
}

export async function persistMemorySafely({ upsert, listOverflow, deleteOverflow }) {
  assertDatabaseSuccess(await upsert(), "memory_upsert");
  if (!listOverflow) return;

  const overflow = assertDatabaseSuccess(await listOverflow(), "memory_prune_lookup");
  if (!Array.isArray(overflow) || overflow.length === 0) return;
  assertDatabaseSuccess(await deleteOverflow(overflow), "memory_prune_delete");
}

export async function suppressThenConsumeToken({ alreadyUsed, suppress, consume }) {
  assertDatabaseSuccess(await suppress(), "unsubscribe_suppression");
  if (!alreadyUsed) assertDatabaseSuccess(await consume(), "unsubscribe_token_update");
}

export function unsubscribeLinkState({ alreadyUsed, suppressionResult }) {
  if (!alreadyUsed) return { valid: true };
  const suppression = assertDatabaseSuccess(suppressionResult, "unsubscribe_suppression_lookup");
  return suppression ? { valid: false, reason: "already_unsubscribed" } : { valid: true };
}

export function retryableUnavailable(error) {
  return Response.json(
    { error },
    {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    },
  );
}

export function noStoreJson(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export function financeQueueUnavailableResponse() {
  return retryableUnavailable("webhook_queue_unavailable");
}
