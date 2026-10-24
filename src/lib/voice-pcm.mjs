// Portable fixed-width PCM contract shared by browser normalization and server
// validation. No decoder, provider, credentials or runtime configuration here.
export const VOICE_SAMPLE_RATE = 16000;
export const MAX_VOICE_SECONDS = 60;
export const MIN_VOICE_SECONDS = 0.1;
export const MAX_PCM_WAV_BYTES = 44 + VOICE_SAMPLE_RATE * MAX_VOICE_SECONDS * 2;
const tag = (view, offset) =>
  String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, 4));
export function inspectVoicePcm(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 44 ||
    bytes.byteLength > MAX_PCM_WAV_BYTES
  )
    throw new Error("invalid_pcm_size");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataBytes = view.getUint32(40, true);
  if (
    tag(view, 0) !== "RIFF" ||
    tag(view, 8) !== "WAVE" ||
    tag(view, 12) !== "fmt " ||
    tag(view, 36) !== "data" ||
    view.getUint32(4, true) !== bytes.byteLength - 8 ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== VOICE_SAMPLE_RATE ||
    view.getUint32(28, true) !== VOICE_SAMPLE_RATE * 2 ||
    view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 ||
    dataBytes !== bytes.byteLength - 44 ||
    dataBytes % 2 !== 0 ||
    dataBytes < VOICE_SAMPLE_RATE * MIN_VOICE_SECONDS * 2
  )
    throw new Error("invalid_pcm_format");
  return {
    durationSeconds: dataBytes / (VOICE_SAMPLE_RATE * 2),
    sampleRate: VOICE_SAMPLE_RATE,
    samples: dataBytes / 2,
  };
}
export function encodeVoicePcm(channels, sampleRate) {
  if (
    !Array.isArray(channels) ||
    channels.length < 1 ||
    channels.length > 2 ||
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 192000
  )
    throw new Error("unsupported_recording_format");
  const frames = channels[0]?.length;
  if (
    !channels.every((channel) => channel instanceof Float32Array && channel.length === frames) ||
    frames < sampleRate * MIN_VOICE_SECONDS ||
    frames > sampleRate * MAX_VOICE_SECONDS
  )
    throw new Error("recording_duration_out_of_range");
  const framesOut = Math.floor((frames * VOICE_SAMPLE_RATE) / sampleRate);
  const bytes = new Uint8Array(44 + framesOut * 2);
  const view = new DataView(bytes.buffer);
  const writeTag = (offset, value) => {
    for (let i = 0; i < 4; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeTag(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  writeTag(8, "WAVE");
  writeTag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_SAMPLE_RATE, true);
  view.setUint32(28, VOICE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, "data");
  view.setUint32(40, framesOut * 2, true);
  for (let index = 0; index < framesOut; index++) {
    const sourcePosition = (index * sampleRate) / VOICE_SAMPLE_RATE;
    const left = Math.floor(sourcePosition);
    const right = Math.min(left + 1, frames - 1);
    const fraction = sourcePosition - left;
    let sample = 0;
    for (const channel of channels)
      sample += channel[left] * (1 - fraction) + channel[right] * fraction;
    sample /= channels.length;
    if (!Number.isFinite(sample)) throw new Error("invalid_recording_samples");
    sample = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  inspectVoicePcm(bytes);
  return bytes;
}
