import { AsyncLocalStorage } from "node:async_hooks";

const eventContextKey = Symbol.for("kovagpt.developer-realtime-events");
const eventContext = (globalThis[eventContextKey] ??= new AsyncLocalStorage());
export function withDeveloperRealtimeEvents(emit, action) {
  return eventContext.run(emit, action);
}

// Bounded native Realtime session. No upstream credentials, socket URLs, or
// arbitrary client events are exposed. An accepted request funds exactly one turn.
export const REALTIME_MODEL = "gpt-realtime-2.1";
export const REALTIME_DIMENSIONS = Object.freeze([
  "realtime_text_input_tokens",
  "realtime_cached_text_tokens",
  "realtime_audio_input_tokens",
  "realtime_cached_audio_tokens",
  "realtime_text_output_tokens",
  "realtime_audio_output_tokens",
]);
const MAX_AUDIO = 240000; // 5 seconds of 24kHz signed 16-bit mono PCM
const MAX_OUTPUT_AUDIO = 960000;
const fail = (code = "developer_realtime_invalid") => {
  throw new Error(code);
};
const integer = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
function audioBytes(value, limit) {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(limit / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    fail();
  const bytes = Buffer.from(value, "base64");
  if (
    !bytes.length ||
    bytes.length > limit ||
    bytes.length % 2 ||
    bytes.toString("base64") !== value
  )
    fail();
  return bytes;
}
export function developerRealtimeFields(input) {
  if (
    !isObject(input) ||
    Object.keys(input).some(
      (key) => !["model", "input", "audio", "output_modality", "max_output_tokens"].includes(key),
    ) ||
    (input.input === undefined) === (input.audio === undefined) ||
    !["text", "audio"].includes(input.output_modality) ||
    !integer(input.max_output_tokens) ||
    input.max_output_tokens < 1 ||
    input.max_output_tokens > 512
  )
    fail();
  if (
    input.input !== undefined &&
    (typeof input.input !== "string" ||
      !input.input.isWellFormed() ||
      !input.input.trim() ||
      input.input.includes("\0") ||
      Buffer.byteLength(input.input) > 1000)
  )
    fail();
  if (input.audio !== undefined && audioBytes(input.audio, MAX_AUDIO).length < 4800) fail();
  return {
    ...(input.input !== undefined ? { input: input.input } : { audio: input.audio }),
    output_modality: input.output_modality,
    max_output_tokens: input.max_output_tokens,
  };
}
export function validDeveloperRealtimeRequest(body) {
  try {
    return body.model === REALTIME_MODEL && !!developerRealtimeFields(body);
  } catch {
    return false;
  }
}
// Per-modality accounting: cached input is a subset, not a second charge.
// Missing, inconsistent or nonzero image accounting fails closed.
export function developerRealtimeUsage(value) {
  const u = value?.usage,
    i = u?.input_token_details,
    o = u?.output_token_details,
    c = i?.cached_tokens_details;
  if (
    value?.model !== REALTIME_MODEL ||
    !["completed", "incomplete", "cancelled", "failed"].includes(value.status) ||
    typeof value.id !== "string" ||
    !/^resp_[A-Za-z0-9_-]{1,180}$/.test(value.id) ||
    ![
      u?.input_tokens,
      u?.output_tokens,
      u?.total_tokens,
      i?.text_tokens,
      i?.audio_tokens,
      i?.cached_tokens,
      o?.text_tokens,
      o?.audio_tokens,
    ].every(integer)
  )
    return null;
  const ct = c?.text_tokens ?? (i.cached_tokens === 0 ? 0 : null),
    ca = c?.audio_tokens ?? (i.cached_tokens === 0 ? 0 : null);
  if (
    ![ct, ca].every(integer) ||
    (i.image_tokens ?? 0) !== 0 ||
    (c?.image_tokens ?? 0) !== 0 ||
    ct + ca !== i.cached_tokens ||
    ct > i.text_tokens ||
    ca > i.audio_tokens ||
    i.text_tokens + i.audio_tokens !== u.input_tokens ||
    o.text_tokens + o.audio_tokens !== u.output_tokens ||
    u.input_tokens + u.output_tokens !== u.total_tokens
  )
    return null;
  return Object.fromEntries(
    REALTIME_DIMENSIONS.map((key, index) => [
      key,
      [i.text_tokens - ct, ct, i.audio_tokens - ca, ca, o.text_tokens, o.audio_tokens][index],
    ]),
  );
}
// Use one fixed, authenticated socket per paid request. The factory is injectable
// for tests. Only a validated response.done receipt can settle the reservation.
export async function runDeveloperRealtime(
  body,
  { apiKey, connect, signal, timeoutMs = 45000, maximumUsage } = {},
) {
  if (!apiKey || !validDeveloperRealtimeRequest(body) || typeof connect !== "function")
    fail("developer_realtime_unavailable");
  const lifetime = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  lifetime.throwIfAborted();
  const emit = eventContext.getStore();
  const socket = connect(`wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`, {
    Authorization: `Bearer ${apiKey}`,
  });
  return new Promise((resolve, reject) => {
    let stage = "created",
      done = false,
      responseId = null,
      bytes = 0,
      text = "",
      transcript = "",
      frames = [],
      count = 0;
    const cleanup = () => {
      lifetime.removeEventListener("abort", abort);
      for (const [event, handler] of [
        ["message", message],
        ["error", error],
        ["close", error],
      ])
        socket.removeEventListener(event, handler);
      // A close while connecting is also required; ignore a subsequent transport error.
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    };
    const stop = (cause, result) => {
      if (done) return;
      done = true;
      cleanup();
      if (cause) reject(cause);
      else resolve(result);
    };
    const error = () => stop(new Error("developer_realtime_unavailable"));
    const abort = () => {
      if (responseId && socket.readyState === 1) {
        try {
          socket.send(JSON.stringify({ type: "response.cancel", response_id: responseId }));
        } catch {
          /* closed */
        }
      }
      error();
    };
    const send = (event) => socket.send(JSON.stringify(event));
    const message = (event) => {
      if (done) return;
      try {
        if (
          ++count > 4096 ||
          typeof event.data !== "string" ||
          Buffer.byteLength(event.data) > 1048576
        )
          return error();
        const value = JSON.parse(event.data);
        if (value.type === "error") return error();
        if (value.type === "session.created") {
          if (stage !== "created" || value.session?.model !== REALTIME_MODEL) return error();
          stage = "updated";
          send({
            type: "session.update",
            session: {
              type: "realtime",
              model: REALTIME_MODEL,
              output_modalities: [body.output_modality],
              instructions: "Answer the user's request. Do not call tools.",
              max_output_tokens: body.max_output_tokens,
              tools: [],
              tool_choice: "none",
              audio: {
                input: { format: { type: "audio/pcm", rate: 24000 }, turn_detection: null },
                output: { format: { type: "audio/pcm", rate: 24000 }, voice: "marin" },
              },
            },
          });
        } else if (value.type === "session.updated") {
          if (
            stage !== "updated" ||
            value.session?.model !== REALTIME_MODEL ||
            value.session.max_output_tokens !== body.max_output_tokens ||
            value.session.audio?.input?.turn_detection !== null ||
            value.session.output_modalities?.join() !== body.output_modality ||
            value.session.tools?.length !== 0 ||
            value.session.tool_choice !== "none" ||
            value.session.audio?.input?.format?.type !== "audio/pcm" ||
            value.session.audio?.input?.format?.rate !== 24000 ||
            value.session.audio?.output?.format?.type !== "audio/pcm" ||
            value.session.audio?.output?.format?.rate !== 24000 ||
            value.session.audio?.output?.voice !== "marin"
          )
            return error();
          stage = "response";
          send({
            type: "response.create",
            response: {
              conversation: "none",
              output_modalities: [body.output_modality],
              max_output_tokens: body.max_output_tokens,
              tools: [],
              tool_choice: "none",
              input: [
                {
                  type: "message",
                  role: "user",
                  content: [
                    body.input !== undefined
                      ? { type: "input_text", text: body.input }
                      : { type: "input_audio", audio: body.audio },
                  ],
                },
              ],
            },
          });
        } else if (value.type === "response.created") {
          if (stage !== "response" || !/^resp_[A-Za-z0-9_-]{1,180}$/.test(value.response?.id ?? ""))
            return error();
          responseId = value.response.id;
          stage = "active";
        } else if (
          [
            "response.output_text.delta",
            "response.output_audio_transcript.delta",
            "response.output_audio.delta",
          ].includes(value.type)
        ) {
          if (
            stage !== "active" ||
            value.response_id !== responseId ||
            typeof value.delta !== "string"
          )
            return error();
          if (value.type === "response.output_audio.delta") {
            if (body.output_modality !== "audio") return error();
            const data = audioBytes(value.delta, MAX_OUTPUT_AUDIO);
            bytes += data.length;
            if (bytes > MAX_OUTPUT_AUDIO) return abort();
            frames.push(data);
          } else if (value.type === "response.output_text.delta") {
            if (body.output_modality !== "text") return error();
            text += value.delta;
          } else {
            if (body.output_modality !== "audio") return error();
            transcript += value.delta;
          }
          if (Buffer.byteLength(text) + Buffer.byteLength(transcript) > 65536) return abort();
          emit?.({
            kind:
              value.type === "response.output_audio.delta"
                ? "audio"
                : value.type === "response.output_text.delta"
                  ? "text"
                  : "transcript",
            delta: value.delta,
          });
        } else if (value.type === "response.done") {
          if (stage !== "active" || value.response?.id !== responseId) return error();
          const receipt = {
            id: responseId,
            model: REALTIME_MODEL,
            status: value.response.status,
            usage: value.response.usage,
          };
          const dimensions = developerRealtimeUsage(receipt);
          if (
            !dimensions ||
            receipt.usage.output_tokens > body.max_output_tokens ||
            (maximumUsage &&
              Object.entries(dimensions).some(
                ([key, value]) => !integer(maximumUsage[key]) || value > maximumUsage[key],
              ))
          )
            return error();
          // On failed/canceled output only expose the status and authoritative usage.
          const successful = ["completed", "incomplete"].includes(receipt.status);
          stop(
            null,
            Response.json({
              ...receipt,
              ...(successful
                ? body.output_modality === "text"
                  ? { text }
                  : {
                      audio: Buffer.concat(frames).toString("base64"),
                      transcript,
                      format: "pcm16",
                      sample_rate: 24000,
                    }
                : {}),
            }),
          );
        }
      } catch {
        error();
      }
    };
    socket.addEventListener("message", message);
    socket.addEventListener("error", error);
    socket.addEventListener("close", error);
    lifetime.addEventListener("abort", abort, { once: true });
    if (lifetime.aborted) abort();
  });
}
