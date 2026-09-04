export class ProviderResponseError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = "ProviderResponseError";
    this.code = code;
    this.status = status;
  }
}

function isTransportInterruption(error) {
  return Boolean(
    error &&
    typeof error === "object" &&
    (error.code === "provider_timeout" || error.name === "AbortError"),
  );
}

function validateLimit(maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }
}

async function cancelBody(source, reason = "provider_response_rejected") {
  await source.body?.cancel(reason).catch(() => undefined);
}

function declaredLength(source, maxBytes) {
  const raw = source.headers.get("content-length");
  if (raw === null) return null;
  const value = raw.trim();
  if (!/^(0|[1-9]\d*)$/u.test(value)) {
    throw new ProviderResponseError("invalid_provider_content_length");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new ProviderResponseError("invalid_provider_content_length");
  }
  if (length > maxBytes) {
    throw new ProviderResponseError("provider_response_too_large");
  }
  return length;
}

function nextCapacity(current, required, maxBytes) {
  let capacity = current || Math.min(64 * 1024, maxBytes);
  while (capacity < required) capacity = Math.min(maxBytes, capacity * 2);
  return capacity;
}

export async function readProviderBytes(source, maxBytes) {
  validateLimit(maxBytes);
  let expected;
  try {
    expected = declaredLength(source, maxBytes);
  } catch (error) {
    await cancelBody(source);
    throw error;
  }
  if (!source.body) {
    if (expected !== null && expected !== 0) {
      throw new ProviderResponseError("provider_response_truncated");
    }
    return new Uint8Array();
  }

  const reader = source.body.getReader();
  let bytes = new Uint8Array(expected ?? Math.min(64 * 1024, maxBytes));
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new ProviderResponseError("invalid_provider_response");
      }
      if (value.byteLength > maxBytes - total) {
        throw new ProviderResponseError("provider_response_too_large");
      }
      const required = total + value.byteLength;
      if (required > bytes.byteLength) {
        const grown = new Uint8Array(nextCapacity(bytes.byteLength, required, maxBytes));
        grown.set(bytes.subarray(0, total));
        bytes = grown;
      }
      bytes.set(value, total);
      total = required;
    }
    if (expected !== null && total !== expected) {
      throw new ProviderResponseError("provider_response_truncated");
    }
  } catch (error) {
    await reader.cancel("provider_response_rejected").catch(() => undefined);
    if (error instanceof ProviderResponseError) throw error;
    throw new ProviderResponseError("invalid_provider_response");
  } finally {
    reader.releaseLock();
  }
  return bytes.slice(0, total);
}

export async function readProviderText(source, maxBytes) {
  const bytes = await readProviderBytes(source, maxBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ProviderResponseError("invalid_provider_utf8");
  }
}

export async function readProviderJsonObject(source, maxBytes) {
  let value;
  try {
    value = JSON.parse(await readProviderText(source, maxBytes));
  } catch (error) {
    if (error instanceof ProviderResponseError) throw error;
    throw new ProviderResponseError("invalid_provider_json");
  }
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new ProviderResponseError("invalid_provider_json");
  }
  return value;
}

export async function createBoundedProviderStream(source, maxBytes, signal) {
  validateLimit(maxBytes);
  let expected;
  try {
    expected = declaredLength(source, maxBytes);
  } catch (error) {
    await cancelBody(source);
    throw error;
  }
  if (!source.body) {
    if (expected !== null && expected !== 0) {
      throw new ProviderResponseError("provider_response_truncated");
    }
    return null;
  }
  if (signal?.aborted) {
    await cancelBody(source, "request_aborted");
    throw new ProviderResponseError("request_aborted", 499);
  }

  const reader = source.body.getReader();
  let total = 0;
  let finished = false;
  let activeController;
  const cleanup = () => signal?.removeEventListener("abort", onAbort);
  const onAbort = () => {
    if (finished) return;
    finished = true;
    cleanup();
    void reader.cancel("request_aborted").catch(() => undefined);
    try {
      activeController?.error(new ProviderResponseError("request_aborted", 499));
    } catch {
      // The consumer may have closed the controller in the same turn.
    }
  };

  return new ReadableStream({
    start(controller) {
      activeController = controller;
      signal?.addEventListener("abort", onAbort, { once: true });
    },
    async pull(controller) {
      if (finished) return;
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (expected !== null && total !== expected) {
            throw new ProviderResponseError("provider_response_truncated");
          }
          finished = true;
          cleanup();
          controller.close();
          return;
        }
        if (!(value instanceof Uint8Array)) {
          throw new ProviderResponseError("invalid_provider_response");
        }
        if (value.byteLength > maxBytes - total) {
          throw new ProviderResponseError("provider_response_too_large");
        }
        total += value.byteLength;
        controller.enqueue(value);
      } catch (error) {
        if (finished) return;
        finished = true;
        cleanup();
        await reader.cancel("provider_response_rejected").catch(() => undefined);
        controller.error(
          error instanceof ProviderResponseError || isTransportInterruption(error)
            ? error
            : new ProviderResponseError("invalid_provider_response"),
        );
      }
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      cleanup();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

export async function createBoundedProviderSseStream(source, maxBytes, signal) {
  const contentType = source.headers.get("content-type") ?? "";
  if (!/^text\/event-stream(?:\s*;|\s*$)/iu.test(contentType)) {
    await cancelBody(source, "invalid_provider_content_type");
    throw new ProviderResponseError("invalid_provider_content_type");
  }

  const bounded = await createBoundedProviderStream(source, maxBytes, signal);
  if (!bounded) throw new ProviderResponseError("empty_provider_response");

  const reader = bounded.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const encoder = new TextEncoder();

  let pendingText = "";
  let finished = false;

  const reject = async (controller, error) => {
    if (finished) return;
    finished = true;
    await reader.cancel("provider_sse_rejected").catch(() => undefined);
    controller.error(
      error instanceof ProviderResponseError || isTransportInterruption(error)
        ? error
        : new ProviderResponseError("invalid_provider_sse"),
    );
  };

  return new ReadableStream({
    async pull(controller) {
      if (finished) return;

      try {
        while (!finished) {
          let newlineIndex = pendingText.indexOf("\n");

          if (newlineIndex !== -1) {
            const line = pendingText.slice(0, newlineIndex + 1);
            pendingText = pendingText.slice(newlineIndex + 1);

            if (line.replace(/\r?\n$/u, "") === "data: [DONE]") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              finished = true;
              await reader.cancel("provider_sse_complete").catch(() => undefined);
              controller.close();
              return;
            }

            controller.enqueue(encoder.encode(line));
            return;
          }

          const { done, value } = await reader.read();

          if (done) {
            pendingText += decoder.decode();

            if (pendingText.length > 0) {
              throw new ProviderResponseError("provider_sse_incomplete_line");
            }

            throw new ProviderResponseError("provider_sse_missing_done");
          }

          pendingText += decoder.decode(value, { stream: true });
        }
      } catch (error) {
        await reject(controller, error);
      }
    },

    async cancel(reason) {
      if (finished) return;
      finished = true;
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}
