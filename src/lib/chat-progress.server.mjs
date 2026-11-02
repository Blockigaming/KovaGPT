import { readProviderText } from "./provider-response.server.mjs";
// Delivers observed work before the final provider response exists. Opt-in keeps
// the non-streaming error contract for older clients and operator captures.
const encoder = new TextEncoder();
const frame = (delta) =>
  encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
export function createChatProgressResponse(
  operation,
  { signal, requestId, maxBytes = 24 * 1024 * 1024 + 65536 } = {},
) {
  const cancellation = new AbortController();
  let controller,
    reader,
    closed = false,
    bytes = 0,
    events = 0;
  let heartbeat;
  const cleanup = () => {
    clearInterval(heartbeat);
    signal?.removeEventListener("abort", abort);
  };
  const cancelReader = (reason) => {
    try {
      void reader?.cancel(reason).catch(() => undefined);
    } catch {
      /* already released */
    }
  };
  const close = () => {
    if (closed) return;
    closed = true;
    cleanup();
    try {
      controller?.close();
    } catch {
      /* canceled */
    }
  };
  const abort = () => {
    cancellation.abort(signal?.reason);
    cancelReader(signal?.reason);
    close();
  };
  const send = (chunk) => {
    if (closed || cancellation.signal.aborted) return false;
    if (chunk.byteLength > maxBytes - bytes) {
      cancellation.abort(new Error("chat_progress_limit"));
      cancelReader();
      close();
      return false;
    }
    bytes += chunk.byteLength;
    controller.enqueue(chunk);
    return true;
  };
  const emit = (delta) => {
    if (events++ >= 512) return;
    if (!delta || !["activity", "progress"].includes(delta.kind)) return;
    const value = frame(delta);
    if (value.byteLength <= 4096) send(value);
  };
  const stream = new ReadableStream({
    start(value) {
      controller = value;
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      send(encoder.encode(": connected\n\n"));
      heartbeat = setInterval(() => send(encoder.encode(": working\n\n")), 15_000);
      // Do not return the task: Stop must be able to cancel before preflight or
      // an external connector finishes. Every request below receives this signal.
      void (async () => {
        try {
          const response = await operation({ emit, signal: cancellation.signal });
          if (closed) {
            void response.body?.cancel().catch(() => undefined);
            return;
          }
          if (
            !response.ok ||
            !response.headers.get("content-type")?.includes("text/event-stream")
          ) {
            let error = "The request could not be completed. Please try again.";
            let code = "chat_request_failed",
              retryable = response.status >= 500 || response.status === 429,
              category;
            // Only public error envelopes returned by the existing handler are
            // forwarded; thrown exceptions and arbitrary response bodies are not.
            if (response.headers.get("content-type")?.includes("application/json")) {
              const body = await readProviderText(response, 65536);
              if (body.length <= 65536) {
                try {
                  const data = JSON.parse(body);
                  if (typeof data.error === "string") error = data.error.slice(0, 800);
                  if (typeof data.code === "string") code = data.code.slice(0, 100);
                  if (typeof data.retryable === "boolean") retryable = data.retryable;
                  if (typeof data.category === "string") category = data.category.slice(0, 100);
                } catch {
                  /* safe fallback */
                }
              }
            } else void response.body?.cancel().catch(() => undefined);
            send(
              frame({
                kind: "error",
                error,
                code,
                status: response.status >= 400 ? response.status : 502,
                retryable,
                category,
                request_id: requestId,
              }),
            );
            send(encoder.encode("data: [DONE]\n\n"));
            return;
          }
          reader = response.body?.getReader();
          if (!reader) throw new Error("missing_stream");
          while (!closed) {
            const result = await reader.read();
            if (result.done) break;
            if (!send(result.value)) break;
          }
        } catch {
          if (!closed && !cancellation.signal.aborted) {
            send(
              frame({
                kind: "error",
                error: "The response was interrupted. Please retry.",
                code: "chat_stream_interrupted",
                status: 502,
                retryable: true,
                request_id: requestId,
              }),
            );
            send(encoder.encode("data: [DONE]\n\n"));
          }
        } finally {
          close();
        }
      })();
    },
    cancel(reason) {
      cancellation.abort(reason);
      cancelReader(reason);
      closed = true;
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store",
      "X-Accel-Buffering": "no",
      "X-Request-Id": requestId ?? "",
    },
  });
}
