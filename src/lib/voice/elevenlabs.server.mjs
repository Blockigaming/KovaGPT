// Server-only ElevenLabs transport. Never import this module from browser code.
// Provider documentation: https://elevenlabs.io/docs/api-reference
import { readVoiceCatalog, publicVoiceCatalog, TTS_MODEL_IDS } from "./catalog.server.mjs";
import { inspectVoicePcm, MAX_PCM_WAV_BYTES } from "../voice-pcm.mjs";
import { voiceModelPolicy } from "./openai-model-eligibility.server.mjs";
export const MAX_AUDIO_BYTES = MAX_PCM_WAV_BYTES;
export const MAX_TEXT_CHARACTERS = 5000;
const MAX_REQUEST_BYTES = MAX_AUDIO_BYTES + 64 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export class VoiceError extends Error {
  constructor(code, status) {
    super(code);
    this.status = status;
  }
}
export function voiceConfiguration(env, tier = "free") {
  const dailyLimit = Number(env("KOVA_VOICE_DAILY_REQUEST_LIMIT"));
  const apiKey = env("ELEVENLABS_API_KEY");
  const catalog = readVoiceCatalog(env, tier);
  const selectedVoice = catalog.entries.find((entry) => entry.id === catalog.defaultVoiceId);
  const voiceId = selectedVoice?.providerVoiceId;
  const captureMode = env("KOVA_REQUEST_CAPTURE_ENABLED");
  const acceptanceMode = env("KOVA_GENERATION_ACCEPTANCE_ENABLED");
  const configured =
    // This separate voice endpoint is outside the reviewed capture/acceptance
    // operation. Refuse before its handler reserves quota or calls a provider.
    env("KOVA_GENERATION_DISABLED") !== "true" &&
    (!captureMode || captureMode === "false") &&
    (!acceptanceMode || acceptanceMode === "false") &&
    catalog.valid &&
    env("KOVA_VOICE_ENABLED") === "true" &&
    Boolean(apiKey) &&
    Number.isSafeInteger(dailyLimit) &&
    dailyLimit > 0;
  const output =
    configured && typeof voiceId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(voiceId);
  const audioEnabled = env("KOVA_VOICE_AUDIO_ENABLED") === "true";
  const stt = configured && audioEnabled;
  const modelPolicy = voiceModelPolicy(env);
  return {
    apiKey,
    voiceId,
    modelId: selectedVoice?.modelId ?? "eleven_multilingual_v2",
    catalog,
    dailyLimit,
    configured,
    stt,
    tts: output,
    sts: output && audioEnabled,
    // Voice conversations use STT, chat, and saved-message /api/speech output.
    // This signals only known configuration gates, never provider readiness.
    conversation: stt && output && env("KOVA_SPEECH_ENABLED") === "true" && modelPolicy.valid,
  };
}
export function publicVoiceConfiguration(config) {
  return {
    configured: config.configured,
    stt: config.stt,
    // Standalone TTS and STS remain available under their existing plan,
    // catalog, quota and server-owned provider configuration. Saved assistant
    // replies use /api/speech for model-bound playback instead.
    tts: config.tts,
    sts: config.sts,
    conversation: config.conversation,
    voices: publicVoiceCatalog(config.catalog),
    defaultVoiceId: config.catalog.defaultVoiceId,
  };
}
export function voiceErrorResponse(error) {
  const known = error instanceof VoiceError;
  return Response.json(
    { error: known ? error.message : "voice_provider_unavailable" },
    {
      status: known ? error.status : 502,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
async function boundedBytes(body, limit, signal) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        // Cleanup must not extend the request deadline if the source's cancel
        // callback never settles. No more bytes are read after this failure.
        void reader.cancel().catch(() => {});
        throw new VoiceError("request_too_large", 413);
      }
      chunks.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
export async function parseVoiceRequest(request) {
  const contentType = request.headers.get("content-type") ?? "";
  const limit = contentType.startsWith("application/json") ? 64 * 1024 : MAX_REQUEST_BYTES;
  if (Number(request.headers.get("content-length")) > limit)
    throw new VoiceError("request_too_large", 413);
  const bytes = await boundedBytes(request.body, limit, request.signal);
  if (contentType.startsWith("application/json")) {
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new VoiceError("invalid_json", 400);
    }
    if (!body || body.action !== "tts" || typeof body.text !== "string" || !body.text.trim())
      throw new VoiceError("invalid_text", 400);
    if (body.text.length > MAX_TEXT_CHARACTERS) throw new VoiceError("request_too_large", 413);
    if (
      body.voiceId !== undefined &&
      (typeof body.voiceId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.voiceId))
    )
      throw new VoiceError("invalid_voice", 400);
    return {
      action: "tts",
      text: body.text.trim(),
      ...(body.voiceId !== undefined ? { voiceId: body.voiceId } : {}),
    };
  }
  if (!contentType.startsWith("multipart/form-data"))
    throw new VoiceError("unsupported_content_type", 415);
  let form;
  try {
    form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new VoiceError("invalid_audio", 400);
  }
  const action = form.get("action");
  const audio = form.get("audio");
  if ((action !== "stt" && action !== "sts") || !(audio instanceof Blob) || audio.size === 0)
    throw new VoiceError("invalid_audio", 400);
  if (audio.size > MAX_AUDIO_BYTES) throw new VoiceError("request_too_large", 413);
  if (audio.type.toLowerCase() !== "audio/wav") throw new VoiceError("invalid_audio", 400);
  try {
    inspectVoicePcm(new Uint8Array(await audio.arrayBuffer()));
  } catch {
    throw new VoiceError("invalid_audio", 400);
  }
  const voiceId = form.get("voiceId");
  if (voiceId !== null && (typeof voiceId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(voiceId)))
    throw new VoiceError("invalid_voice", 400);
  return { action, audio, ...(voiceId !== null ? { voiceId } : {}) };
}
export async function executeVoice(
  input,
  config,
  { fetchImpl = fetch, signal, timeoutMs = 45000 } = {},
) {
  if (input.action === "tts" && !TTS_MODEL_IDS.includes(config.modelId))
    throw new VoiceError("voice_not_configured", 503);
  if (!config[input.action]) throw new VoiceError("voice_not_configured", 503);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    controller.signal.throwIfAborted();
    const headers = { "xi-api-key": config.apiKey };
    let path;
    let body;
    if (input.action === "tts") {
      path = `/v1/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=mp3_44100_128`;
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({ text: input.text, model_id: config.modelId });
    } else {
      body = new FormData();
      if (input.action === "stt") {
        path = "/v1/speech-to-text";
        body.set("file", input.audio, "recording.wav");
        body.set("model_id", "scribe_v2");
        body.set("tag_audio_events", "false");
      } else {
        path = `/v1/speech-to-speech/${encodeURIComponent(config.voiceId)}?output_format=mp3_44100_128`;
        body.set("audio", input.audio, "recording.wav");
        body.set("model_id", "eleven_multilingual_sts_v2");
      }
    }
    const upstream = await fetchImpl(`https://api.elevenlabs.io${path}`, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
      redirect: "error",
    });
    if (!upstream.ok) {
      void upstream.body?.cancel().catch(() => {});
      throw new VoiceError(
        upstream.status === 429 ? "voice_provider_rate_limited" : "voice_provider_unavailable",
        upstream.status === 429 ? 429 : 502,
      );
    }
    const bytes = await boundedBytes(upstream.body, MAX_RESPONSE_BYTES, controller.signal);
    if (input.action === "stt") {
      let result;
      try {
        result = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new VoiceError("voice_invalid_response", 502);
      }
      if (typeof result?.text !== "string" || result.text.length > 50000)
        throw new VoiceError("voice_invalid_response", 502);
      return Response.json({ text: result.text }, { headers: { "Cache-Control": "no-store" } });
    }
    const mediaType = (upstream.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    // The selected output format is MP3. Do not relabel another codec as MP3.
    if (!bytes.length || mediaType !== "audio/mpeg")
      throw new VoiceError("voice_invalid_response", 502);
    return new Response(bytes, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (timedOut) throw new VoiceError("voice_timeout", 504);
    if (signal?.aborted) throw new VoiceError("voice_cancelled", 499);
    if (error instanceof VoiceError) throw error;
    throw new VoiceError("voice_provider_unavailable", 502);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
