export const DEFAULT_JSON_BODY_LIMIT = 64 * 1024;

export class BoundedJsonError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "BoundedJsonError";
    this.code = code;
    this.status = status;
  }
}

function validateLimit(maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }
}

function validateContentLength(request, maxBytes) {
  const raw = request.headers.get("content-length");
  if (raw === null) return;
  const value = raw.trim();
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new BoundedJsonError("invalid_content_length", 400);
  }
  const declaredBytes = Number(value);
  if (!Number.isSafeInteger(declaredBytes)) {
    throw new BoundedJsonError("invalid_content_length", 400);
  }
  if (declaredBytes > maxBytes) {
    throw new BoundedJsonError("request_too_large", 413);
  }
}

function abortReason(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("request_aborted");
  error.name = "AbortError";
  return error;
}

function cancelReaderWithoutWaiting(reader, reason) {
  try {
    void Promise.resolve(reader.cancel(reason)).catch(() => undefined);
  } catch {
    // Cancellation is best-effort; the bounded failure path must remain prompt.
  }
}

async function readChunk(reader, signal) {
  if (!signal) return reader.read();
  if (signal.aborted) {
    cancelReaderWithoutWaiting(reader, signal.reason);
    throw abortReason(signal);
  }

  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => {
      const reason = abortReason(signal);
      reject(reason);
      cancelReaderWithoutWaiting(reader, reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const result = await Promise.race([reader.read(), aborted]);
    if (signal.aborted) throw abortReason(signal);
    return result;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export async function readBoundedUtf8(request, maxBytes = DEFAULT_JSON_BODY_LIMIT, signal) {
  validateLimit(maxBytes);
  validateContentLength(request, maxBytes);

  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await readChunk(reader, signal);
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        cancelReaderWithoutWaiting(reader, "request_too_large");
        throw new BoundedJsonError("request_too_large", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof BoundedJsonError) throw error;
    if (signal?.aborted) throw abortReason(signal);
    if (error?.name === "AbortError") throw error;
    if (error instanceof TypeError) throw new BoundedJsonError("invalid_utf8", 400);
    throw new BoundedJsonError("invalid_request_body", 400);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A cancelled transport may already have released its reader.
    }
  }
}

export async function readBoundedJsonObject(request, maxBytes = DEFAULT_JSON_BODY_LIMIT, signal) {
  const text = await readBoundedUtf8(request, maxBytes, signal);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BoundedJsonError("invalid_json", 400);
  }
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new BoundedJsonError("invalid_json", 400);
  }
  return value;
}
