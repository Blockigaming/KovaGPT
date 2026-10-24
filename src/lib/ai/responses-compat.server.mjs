// Bound the native provider bytes as well as the translated chat stream. Native
// Responses metadata and unknown events must not bypass the chat byte limit.
const MAX_RESPONSES_STREAM_BYTES = 8 * 1024 * 1024;

function streamError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function cancelWithoutWaiting(reader, reason) {
  try {
    void Promise.resolve(reader.cancel(reason)).catch(() => undefined);
  } catch {
    // Provider teardown must not delay Stop or delivery of a terminal event.
  }
}

export function responsesStreamToChatStream(response) {
  if (!response.body) return response;
  // Keep invalid upstream content types intact so the chat ingress rejects them;
  // never relabel an HTTP-200 JSON error as a valid SSE reply.
  if (!/^text\/event-stream(?:\s*;|\s*$)/iu.test(response.headers.get("content-type") ?? "")) {
    return response;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const encoder = new TextEncoder();
  let pending = "";
  let totalBytes = 0;
  let finished = false;
  const stream = new ReadableStream({
    async pull(controller) {
      if (finished) return;
      try {
        while (!finished) {
          const { done, value } = await reader.read();
          if (finished) return;
          if (done) throw streamError("incomplete_provider_stream");
          if (!(value instanceof Uint8Array)) throw streamError("invalid_provider_sse_event");
          if (value.byteLength > MAX_RESPONSES_STREAM_BYTES - totalBytes) {
            throw streamError("provider_response_too_large");
          }
          totalBytes += value.byteLength;
          pending += decoder.decode(value, { stream: true });
          const frames = pending.split(/\r?\n\r?\n/u);
          pending = frames.pop() ?? "";
          let emitted = false;
          for (const frame of frames) {
            const data = frame
              .split(/\r?\n/u)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).replace(/^ /u, ""))
              .join("\n");
            if (!data) continue;
            if (data.trim() === "[DONE]") throw streamError("incomplete_provider_stream");
            let event;
            try {
              event = JSON.parse(data);
            } catch {
              throw streamError("invalid_provider_sse_json");
            }
            if (!event || typeof event !== "object" || Array.isArray(event)) {
              throw streamError("invalid_provider_sse_event");
            }
            if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: event.delta } }] })}\n\n`,
                ),
              );
              emitted = true;
            } else if (
              event.type === "response.function_call_arguments.delta" &&
              typeof event.delta === "string"
            ) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: Number(event.output_index ?? 0), function: { arguments: event.delta } }] } }] })}\n\n`,
                ),
              );
              emitted = true;
            } else if (event.type === "response.completed") {
              if (
                !event.response ||
                typeof event.response !== "object" ||
                Array.isArray(event.response) ||
                event.response.error ||
                event.response.status !== "completed"
              ) {
                throw streamError("provider_response_failed");
              }
              const usage = event.response?.usage;
              if (usage)
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {} }], usage: { prompt_tokens: usage.input_tokens ?? 0, completion_tokens: usage.output_tokens ?? 0, total_tokens: usage.total_tokens ?? 0, input_tokens_details: usage.input_tokens_details, output_tokens_details: usage.output_tokens_details } })}\n\n`,
                  ),
                );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              finished = true;
              pending = "";
              controller.close();
              cancelWithoutWaiting(reader, "provider_sse_complete");
              return;
            } else if (event.type === "response.incomplete") {
              throw streamError("provider_response_incomplete");
            } else if (event.type === "response.failed" || event.type === "error") {
              throw streamError("provider_response_failed");
            }
          }
          if (emitted) return;
        }
      } catch (error) {
        if (finished) return;
        finished = true;
        pending = "";
        cancelWithoutWaiting(reader, "provider_sse_rejected");
        controller.error(error);
      }
    },
    cancel(reason) {
      if (finished) return;
      finished = true;
      pending = "";
      cancelWithoutWaiting(reader, reason);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
  });
}
