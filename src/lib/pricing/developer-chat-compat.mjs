const maximumBytes = 8 * 1024 * 1024;
const invalid = () => {
  throw new Error("developer_provider_unavailable");
};
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;

function metadata(value, publicModel, expectedModels) {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    !/^resp_[A-Za-z0-9_-]{1,180}$/.test(value.id) ||
    !count(value.created_at) ||
    !Array.isArray(expectedModels) ||
    !expectedModels.includes(value.model)
  )
    invalid();
  return {
    id: "chatcmpl-" + value.id.slice(5),
    created: value.created_at,
    model: publicModel,
  };
}
function completion(value, publicModel, expectedModels) {
  const meta = metadata(value, publicModel, expectedModels);
  const usage = value.usage;
  if (
    !Array.isArray(value.output) ||
    value.output.length > 256 ||
    !object(usage) ||
    ![usage.input_tokens, usage.output_tokens, usage.total_tokens].every(count) ||
    usage.input_tokens + usage.output_tokens !== usage.total_tokens ||
    value.error
  )
    invalid();
  let finish = "stop";
  if (value.status === "incomplete") {
    if (value.incomplete_details?.reason === "max_output_tokens") finish = "length";
    else if (value.incomplete_details?.reason === "content_filter") finish = "content_filter";
    else invalid();
  } else if (value.status !== "completed") invalid();
  let text = "",
    refusal = "";
  for (const item of value.output) {
    if (item?.type === "reasoning") continue;
    if (item?.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content))
      invalid();
    for (const part of item.content) {
      if (part?.type === "output_text" && typeof part.text === "string") text += part.text;
      else if (part?.type === "refusal" && typeof part.refusal === "string") refusal += part.refusal;
      else invalid();
    }
  }
  return {
    ...meta,
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text || null, refusal: refusal || null },
        finish_reason: finish,
      },
    ],
    usage: {
      prompt_tokens: usage.input_tokens,
      completion_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
    },
  };
}

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
function contentType(response, type) {
  return (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() === type;
}

export async function developerChatCompletion(response, { publicModel, expectedModels, stream }) {
  if (!response.ok || !response.body) invalid();
  if (!contentType(response, stream ? "text/event-stream" : "application/json")) {
    await response.body.cancel().catch(() => {});
    invalid();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  async function read() {
    const { done, value } = await reader.read();
    if (done) return { done, text: decoder.decode() };
    if (!(value instanceof Uint8Array) || value.byteLength > maximumBytes - total) invalid();
    total += value.byteLength;
    return { done, text: decoder.decode(value, { stream: true }) };
  }
  if (!stream) {
    try {
      let json = "";
      for (;;) {
        const next = await read();
        json += next.text;
        if (next.done) break;
      }
      const value = completion(JSON.parse(json), publicModel, expectedModels);
      return Response.json(value, { headers });
    } catch {
      invalid();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  const encoder = new TextEncoder();
  let pending = "",
    meta = null,
    terminal = null,
    observedText = "",
    observedRefusal = "",
    canceled = false;
  const format = (value) => encoder.encode("data: " + JSON.stringify(value) + "\n\n");
  const chunk = (delta, finish_reason = null, usage) => ({
    ...meta,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta, finish_reason }],
    ...(usage ? { usage } : {}),
  });
  function consume(frame, controller) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return;
    if (data === "[DONE]") {
      if (!terminal) invalid();
      return;
    }
    if (terminal) invalid();
    const event = JSON.parse(data);
    if (!object(event)) invalid();
    if (event.type === "response.created") {
      if (meta) invalid();
      meta = metadata(event.response, publicModel, expectedModels);
      controller.enqueue(format(chunk({ role: "assistant" })));
    } else if (
      event.type === "response.output_text.delta" ||
      event.type === "response.refusal.delta"
    ) {
      if (!meta || typeof event.delta !== "string") invalid();
      if (event.type === "response.refusal.delta") {
        observedRefusal += event.delta;
        controller.enqueue(format(chunk({ refusal: event.delta })));
      } else {
        observedText += event.delta;
        controller.enqueue(format(chunk({ content: event.delta })));
      }
    } else if (["response.completed", "response.incomplete"].includes(event.type)) {
      if (!meta) invalid();
      terminal = completion(event.response, publicModel, expectedModels);
      if (
        terminal.id !== meta.id ||
        terminal.created !== meta.created ||
        (terminal.choices[0].message.content ?? "") !== observedText ||
        (terminal.choices[0].message.refusal ?? "") !== observedRefusal
      )
        invalid();
    } else if (
      event.type === "response.failed" ||
      event.type === "error" ||
      event.type?.startsWith?.("response.function_call") ||
      (event.type === "response.output_item.added" &&
        !["message", "reasoning"].includes(event.item?.type))
    ) {
      invalid();
    }
    // Other native metadata and reasoning events never enter the public stream.
  }
  return new Response(
    new ReadableStream({
      async pull(controller) {
        try {
          const next = await read();
          if (canceled) return;
          pending += next.text;
          let frame;
          while ((frame = /\r?\n\r?\n/.exec(pending))) {
            consume(pending.slice(0, frame.index), controller);
            pending = pending.slice(frame.index + frame[0].length);
          }
          if (next.done) {
            if (!terminal || pending.trim()) invalid();
            controller.enqueue(format(chunk({}, terminal.choices[0].finish_reason, terminal.usage)));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            reader.releaseLock();
            controller.close();
          }
        } catch {
          if (canceled) return;
          await reader.cancel().catch(() => {});
          reader.releaseLock();
          controller.error(new Error("developer_provider_unavailable"));
        }
      },
      async cancel(reason) {
        canceled = true;
        await reader.cancel(reason).catch(() => {});
        reader.releaseLock();
      },
    }),
    { headers: { ...headers, "Content-Type": "text/event-stream" } },
  );
}
