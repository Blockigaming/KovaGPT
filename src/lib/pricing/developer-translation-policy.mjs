// Dedicated native Realtime translation protocol. No caller-controlled provider
// options, additional transcription model, or long-lived provider credentials.
export const TRANSLATION_MODEL = "gpt-realtime-translate";
export const TRANSLATION_MAX_SECONDS = 10;
export const TRANSLATION_ACCOUNTING = "closed_input_frames";
export const TRANSLATION_LANGUAGES = Object.freeze([
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ja",
  "ko",
  "zh",
]);
const FRAME_BYTES = 9600; // 200 ms, 24 kHz, mono PCM16
const MAX_BYTES = TRANSLATION_MAX_SECONDS * 48000;
const MAX_OUTPUT_BYTES = 960000;
const unavailable = () => new Error("developer_translation_unavailable");
const invalid = () => new Error("developer_translation_invalid");
function decode(value, limit) {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(limit / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    throw invalid();
  const bytes = Buffer.from(value, "base64");
  if (
    !bytes.length ||
    bytes.length > limit ||
    bytes.length % 2 ||
    bytes.toString("base64") !== value
  )
    throw invalid();
  return bytes;
}
export function developerTranslationFields(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !["model", "audio", "target_language"].includes(k)) ||
    !TRANSLATION_LANGUAGES.includes(input.target_language)
  )
    throw invalid();
  const bytes = decode(input.audio, MAX_BYTES);
  // Require exact provider engine frames rather than silently padding billable audio.
  if (bytes.length < FRAME_BYTES || bytes.length % FRAME_BYTES) throw invalid();
  return { audio: input.audio, target_language: input.target_language };
}
export function developerTranslationSeconds(body) {
  return decode(developerTranslationFields(body).audio, MAX_BYTES).length / 48000;
}
export function validDeveloperTranslationRequest(body) {
  try {
    return body.model === TRANSLATION_MODEL && developerTranslationSeconds(body) > 0;
  } catch {
    return false;
  }
}
export function developerTranslationReceipt(value) {
  const seconds = value?.usage?.translation_seconds;
  if (
    value?.model !== TRANSLATION_MODEL ||
    value.status !== "completed" ||
    typeof value.id !== "string" ||
    !/^sess_[A-Za-z0-9_-]{1,180}$/.test(value.id) ||
    value.usage?.accounting !== TRANSLATION_ACCOUNTING ||
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds < 0.2 ||
    seconds > TRANSLATION_MAX_SECONDS ||
    !Number.isInteger(seconds * 5)
  )
    return null;
  return { translation_seconds: seconds };
}
export async function runDeveloperTranslation(
  body,
  { apiKey, connect, signal, timeoutMs = 45000 } = {},
) {
  if (!apiKey || !validDeveloperTranslationRequest(body) || typeof connect !== "function")
    throw unavailable();
  const source = decode(body.audio, MAX_BYTES);
  const deadline = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  deadline.throwIfAborted();
  const socket = connect(
    `wss://api.openai.com/v1/realtime/translations?model=${TRANSLATION_MODEL}`,
    { Authorization: `Bearer ${apiKey}` },
  );
  return new Promise((resolve, reject) => {
    let phase = "created",
      id = null,
      finished = false,
      count = 0,
      sent = 0,
      outputBytes = 0,
      text = "";
    const chunks = [],
      events = new Set();
    const stop = (error, result) => {
      if (finished) return;
      finished = true;
      deadline.removeEventListener("abort", abort);
      socket.removeEventListener("message", message);
      socket.removeEventListener("error", fail);
      socket.removeEventListener("close", fail);
      try {
        socket.close();
      } catch {
        /* transport already closed */
      }
      if (error) reject(error);
      else resolve(result);
    };
    const fail = () => stop(unavailable());
    const send = (value) => socket.send(JSON.stringify(value));
    const abort = () => {
      if (socket.readyState === 1 && phase !== "created") {
        try {
          send({ type: "session.close" });
        } catch {
          /* closed */
        }
      }
      fail();
    };
    const session = (value) =>
      value &&
      value.model === TRANSLATION_MODEL &&
      value.type === "translation" &&
      typeof value.id === "string" &&
      /^sess_[A-Za-z0-9_-]{1,180}$/.test(value.id);
    const message = (event) => {
      if (finished) return;
      try {
        if (
          ++count > 4096 ||
          typeof event.data !== "string" ||
          Buffer.byteLength(event.data) > 1048576
        )
          return fail();
        const value = JSON.parse(event.data);
        if (
          typeof value.event_id !== "string" ||
          !value.event_id ||
          value.event_id.length > 200 ||
          events.has(value.event_id)
        )
          return fail();
        events.add(value.event_id);
        switch (value.type) {
          case "session.created":
            if (phase !== "created" || !session(value.session)) return fail();
            id = value.session.id;
            phase = "updated";
            send({
              type: "session.update",
              session: {
                audio: {
                  input: { transcription: null, noise_reduction: null },
                  output: { language: body.target_language },
                },
              },
            });
            return;
          case "session.updated":
            if (
              phase !== "updated" ||
              !session(value.session) ||
              value.session.id !== id ||
              value.session.audio?.output?.language !== body.target_language ||
              value.session.audio?.input?.transcription != null ||
              value.session.audio?.input?.noise_reduction != null
            )
              return fail();
            phase = "closing";
            for (let i = 0; i < source.length; i += FRAME_BYTES) {
              deadline.throwIfAborted();
              send({
                type: "session.input_audio_buffer.append",
                audio: source.subarray(i, i + FRAME_BYTES).toString("base64"),
              });
              sent += FRAME_BYTES;
            }
            send({ type: "session.close" });
            return;
          case "session.output_transcript.delta":
            if (
              phase !== "closing" ||
              typeof value.delta !== "string" ||
              !value.delta.isWellFormed()
            )
              return fail();
            text += value.delta;
            if (Buffer.byteLength(text) > 65536) return fail();
            return;
          case "session.output_audio.delta": {
            if (
              phase !== "closing" ||
              (value.format ?? "pcm16") !== "pcm16" ||
              (value.sample_rate ?? 24000) !== 24000 ||
              (value.channels ?? 1) !== 1
            )
              return fail();
            const chunk = decode(value.delta, MAX_OUTPUT_BYTES);
            outputBytes += chunk.length;
            if (outputBytes > MAX_OUTPUT_BYTES) return fail();
            chunks.push(chunk);
            return;
          }
          case "session.closed": {
            if (phase !== "closing" || sent !== source.length) return fail();
            // The documented graceful close flushes all submitted frames. This is
            // application-observed duration, NOT a provider usage-total receipt.
            // Admission separately requires an owner-approved accounting basis.
            const usage = { translation_seconds: sent / 48000, accounting: TRANSLATION_ACCOUNTING };
            const result = {
              id,
              model: TRANSLATION_MODEL,
              status: "completed",
              target_language: body.target_language,
              text,
              audio: Buffer.concat(chunks).toString("base64"),
              format: "pcm16",
              sample_rate: 24000,
              usage,
            };
            if (!developerTranslationReceipt(result)) return fail();
            stop(null, Response.json(result));
            return;
          }
          default:
            return fail();
        }
      } catch {
        fail();
      }
    };
    socket.addEventListener("message", message);
    socket.addEventListener("error", fail);
    socket.addEventListener("close", fail);
    deadline.addEventListener("abort", abort, { once: true });
    if (deadline.aborted) abort();
  });
}
