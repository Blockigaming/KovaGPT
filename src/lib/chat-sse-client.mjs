// Generated images are delivered as one base64 SSE event. Keep this slightly
// above the server's 16 MiB image-provider response contract so valid images
// are accepted while every unterminated event remains strictly bounded.
const DEFAULT_MAX_BUFFER_CHARS = 16 * 1024 * 1024 + 64 * 1024;
// Azure generation permits a 120-second provider deadline. The browser idle
// watchdog must not reject a valid request before that server-side bound.
const DEFAULT_IDLE_TIMEOUT_MS = 130_000;
const MAX_ERROR_BODY_BYTES = 64 * 1024;

function defaultRetryable(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function cancelReaderWithoutWaiting(reader, reason) {
  try {
    void Promise.resolve(reader.cancel(reason)).catch(() => undefined);
  } catch {
    // Cancellation is best-effort and must not extend the UI failure path.
  }
}

function abortReason(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("chat_request_aborted");
  error.name = "AbortError";
  return error;
}

async function readWithSignal(reader, signal, idleTimeoutMs) {
  if (signal?.aborted) throw abortReason(signal);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    if (!signal) return;
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  let timeoutId;
  const timedOut = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () =>
        reject(
          new ChatStreamError(
            "chat_stream_timeout",
            "KovaGPT took too long to continue this response. Please retry.",
            { status: 504, retryable: true },
          ),
        ),
      idleTimeoutMs,
    );
  });
  try {
    return await Promise.race([reader.read(), aborted, timedOut]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export class ChatStreamError extends Error {
  constructor(
    code,
    message,
    { status = 502, retryable = true, category = "streaming_interruption", requestId } = {},
  ) {
    super(message);
    this.name = "ChatStreamError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.category = category;
    this.requestId = requestId;
  }
}

function protocolError(code, message) {
  return new ChatStreamError(code, message, { status: 502, retryable: true });
}

export async function consumeChatSse(
  stream,
  {
    signal,
    onEvent,
    maxBufferChars = DEFAULT_MAX_BUFFER_CHARS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  } = {},
) {
  if (!stream || typeof stream.getReader !== "function") {
    throw protocolError("chat_stream_missing_body", "KovaGPT returned an empty response.");
  }
  if (!Number.isSafeInteger(maxBufferChars) || maxBufferChars < 1) {
    throw new TypeError("maxBufferChars must be a positive safe integer");
  }
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
    throw new TypeError("idleTimeoutMs must be a positive finite number");
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let receivedDone = false;

  const processLine = async (rawLine) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(":")) return;
    if (!line.startsWith("data:")) return;

    const data = line.slice(5).trimStart().trimEnd();
    if (data === "[DONE]") {
      receivedDone = true;
      return;
    }
    if (!data) return;

    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw protocolError(
        "chat_stream_malformed_json",
        "KovaGPT returned an invalid streaming response. Please retry.",
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw protocolError(
        "chat_stream_invalid_event",
        "KovaGPT returned an invalid streaming response. Please retry.",
      );
    }
    const delta = parsed.choices?.[0]?.delta;
    if (delta?.kind === "error") {
      const status =
        Number.isSafeInteger(delta.status) && delta.status >= 400 && delta.status <= 599
          ? delta.status
          : 502;
      throw new ChatStreamError(
        typeof delta.code === "string" && delta.code ? delta.code : "chat_stream_provider_error",
        typeof delta.error === "string" && delta.error
          ? delta.error
          : "KovaGPT could not complete this response. Please retry.",
        {
          status,
          retryable:
            typeof delta.retryable === "boolean" ? delta.retryable : defaultRetryable(status),
          category:
            typeof delta.category === "string" && delta.category
              ? delta.category
              : "model_provider_failure",
          requestId:
            typeof delta.request_id === "string" && delta.request_id ? delta.request_id : undefined,
        },
      );
    }
    await onEvent?.(parsed);
  };

  try {
    while (!receivedDone) {
      const { done, value } = await readWithSignal(reader, signal, Math.floor(idleTimeoutMs));
      if (done) {
        buffer += decoder.decode();
        if (buffer) {
          const finalLines = buffer.split("\n");
          buffer = "";
          for (const line of finalLines) {
            await processLine(line);
            if (receivedDone) break;
          }
        }
        break;
      }
      if (!(value instanceof Uint8Array)) {
        throw protocolError(
          "chat_stream_invalid_chunk",
          "KovaGPT returned an invalid streaming response. Please retry.",
        );
      }
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > maxBufferChars) {
        throw protocolError(
          "chat_stream_event_too_large",
          "KovaGPT returned an oversized streaming event. Please retry.",
        );
      }

      let lineEnd;
      while (!receivedDone && (lineEnd = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 1);
        await processLine(line);
      }
    }

    if (!receivedDone) {
      throw protocolError(
        "chat_stream_missing_done",
        "KovaGPT's response ended early. Please retry.",
      );
    }
    // DONE completes the UI, but the server may still be finalizing usage.
    // Releasing the reader below preserves that successful response; cancel
    // would turn it into a client disconnect before accounting has settled.
  } catch (error) {
    cancelReaderWithoutWaiting(reader, "chat_stream_rejected");
    if (error instanceof TypeError && /encoded data/u.test(error.message)) {
      throw protocolError(
        "chat_stream_invalid_utf8",
        "KovaGPT returned an invalid streaming response. Please retry.",
      );
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A transport may already have released its reader while aborting.
    }
  }
}

async function readErrorPayload(response) {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await readWithSignal(reader, undefined, 10_000);
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength > MAX_ERROR_BODY_BYTES - total) {
        cancelReaderWithoutWaiting(reader, "chat_error_body_rejected");
        return {};
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    cancelReaderWithoutWaiting(reader, "chat_error_body_failed");
    return {};
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore transports that release the reader during cancellation.
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export async function chatResponseError(response, fallbackMessage = "Chat failed") {
  const payload = await readErrorPayload(response);
  const message =
    typeof payload.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : response.status
        ? `${fallbackMessage} (HTTP ${response.status})`
        : fallbackMessage;
  const error = new Error(message);
  error.name = "ChatRequestError";
  error.status = response.status;
  error.code =
    typeof payload.code === "string" && payload.code
      ? payload.code
      : `chat_http_${response.status || "error"}`;
  error.category =
    typeof payload.category === "string" && payload.category ? payload.category : undefined;
  error.requestId =
    typeof payload.requestId === "string" && payload.requestId
      ? payload.requestId
      : response.headers.get("x-request-id") || undefined;
  error.retryable =
    typeof payload.retryable === "boolean" ? payload.retryable : defaultRetryable(response.status);
  const retryAfter = response.headers.get("retry-after");
  error.retryAfter = retryAfter && /^\d+$/u.test(retryAfter) ? Number(retryAfter) : undefined;
  return error;
}
