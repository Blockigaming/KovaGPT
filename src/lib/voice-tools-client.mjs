import { readResponseBytesBounded } from "./endpoint-reliability.mjs";
import { inspectVoicePcm, MAX_PCM_WAV_BYTES } from "./voice-pcm.mjs";

const voiceIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const errors = {
  account_changed: "Your account changed. Open Audio tools again.",
  email_verification_required: "Verify your email address before using Audio tools.",
  session_expired: "Your session expired. Sign in again.",
  voice_not_configured: "This audio operation is unavailable for your account.",
  voice_plan_required: "This voice is unavailable on your current Kova plan.",
  quota_exceeded: "Your audio allowance has been reached.",
  voice_provider_rate_limited: "The audio provider is busy. Try again later.",
};
const invalid = () => new Error("The audio service returned an unreadable response.");
async function readJson(response, signal) {
  const bytes = await readResponseBytesBounded(response, 256 * 1024, { signal });
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw invalid();
  }
}
async function checked(response, signal) {
  if (response.ok) return response;
  const body = await readJson(response, signal);
  throw new Error(
    errors[body?.error] ??
      (response.status === 401
        ? "Sign in to use Audio tools."
        : response.status === 429
          ? "Your audio allowance is unavailable or has been reached."
          : "The audio operation could not be completed. Try again later."),
  );
}
function headers(ownerId) {
  if (typeof ownerId !== "string" || !ownerId) throw new Error("Sign in to use Audio tools.");
  return { "x-kova-voice-owner": ownerId };
}
export async function loadVoiceTools(ownerId, { signal, fetchImpl = fetch } = {}) {
  const response = await checked(
    await fetchImpl("/api/voice", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: headers(ownerId),
      signal,
    }),
    signal,
  );
  const body = await readJson(response, signal);
  if (
    !body ||
    ["configured", "tts", "stt", "sts"].some((key) => typeof body[key] !== "boolean") ||
    !Array.isArray(body.voices) ||
    body.voices.length > 32 ||
    body.voices.some(
      (voice) =>
        !voice ||
        typeof voice.id !== "string" ||
        !voiceIdPattern.test(voice.id) ||
        typeof voice.label !== "string" ||
        !voice.label.trim() ||
        voice.label.length > 80 ||
        typeof voice.available !== "boolean",
    ) ||
    new Set(body.voices.map((voice) => voice.id)).size !== body.voices.length ||
    (body.defaultVoiceId !== null &&
      !body.voices.some((voice) => voice.id === body.defaultVoiceId && voice.available))
  )
    throw invalid();
  return body;
}

export async function submitVoiceTool(
  { ownerId, action, text, audio, voiceId },
  { signal, fetchImpl = fetch } = {},
) {
  const requestHeaders = headers(ownerId);
  if (!["tts", "stt", "sts"].includes(action)) throw new Error("Choose an audio operation.");
  if (action !== "stt" && (typeof voiceId !== "string" || !voiceIdPattern.test(voiceId)))
    throw new Error("Choose an available voice.");
  let body;
  if (action === "tts") {
    if (typeof text !== "string" || !text.trim() || text.length > 5000)
      throw new Error("Enter up to 5,000 characters to speak.");
    requestHeaders["Content-Type"] = "application/json";
    body = JSON.stringify({ action, text: text.trim(), voiceId });
  } else {
    if (
      !(audio instanceof Blob) ||
      !audio.size ||
      audio.size > MAX_PCM_WAV_BYTES ||
      audio.type !== "audio/wav"
    )
      throw new Error("Choose a short audio file before running this operation.");
    inspectVoicePcm(new Uint8Array(await audio.arrayBuffer()));
    signal?.throwIfAborted();
    body = new FormData();
    body.set("action", action);
    body.set("audio", audio, "recording.wav");
    if (action === "sts") body.set("voiceId", voiceId);
  }
  signal?.throwIfAborted();
  const response = await checked(
    await fetchImpl("/api/voice", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: requestHeaders,
      body,
      signal,
    }),
    signal,
  );
  if (action === "stt") {
    const result = await readJson(response, signal);
    if (typeof result?.text !== "string" || !result.text.trim() || result.text.length > 50000)
      throw invalid();
    return { text: result.text };
  }
  if (
    response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "audio/mpeg"
  ) {
    void response.body?.cancel().catch(() => {});
    throw invalid();
  }
  const bytes = await readResponseBytesBounded(response, 16 * 1024 * 1024, { signal });
  if (!bytes.length) throw invalid();
  return { audio: new Blob([bytes], { type: "audio/mpeg" }) };
}
