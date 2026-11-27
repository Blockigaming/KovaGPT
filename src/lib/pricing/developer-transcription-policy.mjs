export const TRANSCRIPTION_MODEL = "gpt-transcribe";
export const TRANSCRIPTION_MAX_SECONDS = 20;
export const TRANSCRIPTION_BODY_LIMIT = 1048576;
const prefix = "data:audio/wav;base64,";
const fail = () => {
  throw new Error("developer_transcription_invalid");
};

// Accept a canonical 44-byte PCM WAVE header only. The caller cannot conceal
// an unbounded recording in metadata, compressed audio, or a second chunk.
export function developerTranscriptionAudio(value) {
  if (typeof value !== "string" || !value.startsWith(prefix) || value.length > 853420) fail();
  const encoded = value.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) fail();
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded || bytes.length < 3244 || bytes.length > 640044)
    fail();
  const size = bytes.length - 44;
  if (
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.readUInt32LE(4) !== bytes.length - 8 ||
    bytes.toString("ascii", 8, 16) !== "WAVEfmt " ||
    bytes.readUInt32LE(16) !== 16 ||
    bytes.readUInt16LE(20) !== 1 ||
    bytes.readUInt16LE(22) !== 1 ||
    bytes.readUInt32LE(24) !== 16000 ||
    bytes.readUInt32LE(28) !== 32000 ||
    bytes.readUInt16LE(32) !== 2 ||
    bytes.readUInt16LE(34) !== 16 ||
    bytes.toString("ascii", 36, 40) !== "data" ||
    bytes.readUInt32LE(40) !== size ||
    size % 2 !== 0
  )
    fail();
  return { bytes, seconds: size / 32000 };
}

export function developerTranscriptionFields(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail();
  if (Object.keys(input).some((key) => !["model", "audio"].includes(key))) fail();
  developerTranscriptionAudio(input.audio);
  return { audio: input.audio, response_format: "json" };
}

export function validDeveloperTranscriptionRequest(body) {
  try {
    if (
      body?.model !== TRANSCRIPTION_MODEL ||
      body.response_format !== "json" ||
      Object.keys(body).length !== 3
    )
      return false;
    developerTranscriptionAudio(body.audio);
    return true;
  } catch {
    return false;
  }
}

export function developerTranscriptionReceipt(value) {
  if (
    value?.model !== TRANSCRIPTION_MODEL ||
    value.status !== "completed" ||
    typeof value.id !== "string" ||
    !/^req_[A-Za-z0-9_-]{1,180}$/.test(value.id) ||
    value.usage?.type !== "duration" ||
    typeof value.usage.seconds !== "number" ||
    !Number.isFinite(value.usage.seconds) ||
    value.usage.seconds <= 0 ||
    value.usage.seconds > 600
  )
    return null;
  return { transcription_seconds: value.usage.seconds };
}

export function developerTranscriptionResult(value, requestId) {
  const result = {
    id: requestId,
    model: TRANSCRIPTION_MODEL,
    status: "completed",
    text: value?.text,
    usage: value?.usage,
  };
  if (
    typeof result.text !== "string" ||
    Buffer.byteLength(result.text) > 65536 ||
    !developerTranscriptionReceipt(result)
  )
    throw new Error("developer_transcription_unavailable");
  return { ...result, usage: { type: "duration", seconds: result.usage.seconds } };
}
