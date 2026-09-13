export function responsesStreamToChatStream(response) {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let completed = false;
  const stream = new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (!completed) controller.error(new Error("incomplete_provider_stream"));
          else controller.close();
          return;
        }
        pending += decoder.decode(value, { stream: true });
        const frames = pending.split("\n\n");
        pending = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame
            .split("\n")
            .find((line) => line.startsWith("data:"))
            ?.slice(5)
            .trim();
          if (!data || data === "[DONE]") continue;
          let event;
          try {
            event = JSON.parse(data);
          } catch {
            await reader.cancel("invalid_provider_sse_json").catch(() => undefined);
            controller.error(new Error("invalid_provider_sse_json"));
            return;
          }
          if (!event || typeof event !== "object" || Array.isArray(event)) {
            await reader.cancel("invalid_provider_sse_event").catch(() => undefined);
            controller.error(new Error("invalid_provider_sse_event"));
            return;
          }
          if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: event.delta } }] })}\n\n`,
              ),
            );
          } else if (
            event.type === "response.function_call_arguments.delta" &&
            typeof event.delta === "string"
          ) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: Number(event.output_index ?? 0), function: { arguments: event.delta } }] } }] })}\n\n`,
              ),
            );
          } else if (event.type === "response.completed") {
            const usage = event.response?.usage;
            if (usage)
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {} }], usage: { prompt_tokens: usage.input_tokens ?? 0, completion_tokens: usage.output_tokens ?? 0, total_tokens: usage.total_tokens ?? 0, input_tokens_details: usage.input_tokens_details, output_tokens_details: usage.output_tokens_details } })}\n\n`,
                ),
              );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            completed = true;
          }
        }
        if (frames.length) return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
  });
}
