import { readResponseBytesBounded } from "../endpoint-reliability.mjs";

export const SPEECH_MODEL = "eleven_flash_v2_5";
export const SPEECH_MAX_CHARACTERS = 1000;
export const SPEECH_MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const fail = (code = "developer_speech_invalid") => {
  throw new Error(code);
};
const validVoice = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
export function developerSpeechFields(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) => !["model", "input", "voice", "response_format"].includes(key),
    ) ||
    typeof input.input !== "string" ||
    !input.input.isWellFormed() ||
    !input.input.trim() ||
    input.input.includes("\0") ||
    Buffer.byteLength(input.input) > SPEECH_MAX_CHARACTERS ||
    input.voice !== "default" ||
    (input.response_format !== undefined && input.response_format !== "mp3")
  )
    fail();
  return { input: input.input, voice: "default", response_format: "mp3" };
}
// The concrete consent-reviewed voice is selected only by the server and bound into the quote.
export function bindDeveloperSpeechVoice(body, approvedVoice) {
  if (!validVoice(approvedVoice)) fail("developer_speech_unavailable");
  return { ...body, provider_voice: approvedVoice };
}
export function validDeveloperSpeechRequest(body) {
  try {
    if (body?.model !== SPEECH_MODEL || !validVoice(body.provider_voice)) return false;
    const { provider_voice: _voice, ...request } = body;
    const normalized = developerSpeechFields(request);
    return (
      Object.keys(request).length === 4 && normalized.response_format === request.response_format
    );
  } catch {
    return false;
  }
}
export function developerSpeechReceipt(value) {
  const characters = value?.usage?.speech_character_credits;
  if (
    value?.model !== SPEECH_MODEL ||
    value.status !== "completed" ||
    typeof value.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,180}$/.test(value.id) ||
    !Number.isSafeInteger(characters) ||
    characters < 1 ||
    characters > SPEECH_MAX_CHARACTERS
  )
    return null;
  return { speech_character_credits: characters };
}
// Provider character-cost and request-id headers are required; no guessed usage.
export async function runDeveloperSpeech(
  body,
  { apiKey, approvedVoice, fetchImpl = fetch, signal } = {},
) {
  if (!apiKey || !validDeveloperSpeechRequest(body) || body.provider_voice !== approvedVoice)
    fail("developer_speech_unavailable");
  const response = await fetchImpl(
    `https://api.elevenlabs.io/v1/text-to-speech/${body.provider_voice}?output_format=mp3_44100_128`,
    {
      method: "POST",
      redirect: "error",
      signal,
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text: body.input,
        model_id: SPEECH_MODEL,
        apply_text_normalization: "off",
      }),
    },
  );
  const cost = response.headers.get("character-cost");
  const receipt = {
    id: response.headers.get("request-id"),
    model: SPEECH_MODEL,
    status: "completed",
    usage: { speech_character_credits: /^\d{1,4}$/.test(cost ?? "") ? Number(cost) : null },
  };
  if (
    !response.ok ||
    response.headers.get("content-type")?.split(";", 1)[0].trim() !== "audio/mpeg" ||
    !developerSpeechReceipt(receipt) ||
    receipt.usage.speech_character_credits > Buffer.byteLength(body.input)
  ) {
    await response.body?.cancel().catch(() => {});
    fail("developer_speech_unavailable");
  }
  const bytes = await readResponseBytesBounded(response, SPEECH_MAX_AUDIO_BYTES, {
    signal,
    timeoutMs: 60000,
  });
  // MPEG audio sync or ID3 header, not an arbitrary HTML/error body.
  if (
    bytes.length < 4 ||
    !(
      Buffer.from(bytes.subarray(0, 3)).toString("ascii") === "ID3" ||
      (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    )
  )
    fail("developer_speech_unavailable");
  return Response.json({
    ...receipt,
    audio: Buffer.from(bytes).toString("base64"),
    format: "mp3",
    generated: true,
  });
}
