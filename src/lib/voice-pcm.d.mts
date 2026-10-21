export const VOICE_SAMPLE_RATE: number;
export const MAX_VOICE_SECONDS: number;
export const MIN_VOICE_SECONDS: number;
export const MAX_PCM_WAV_BYTES: number;
export function inspectVoicePcm(bytes: Uint8Array): {
  durationSeconds: number;
  sampleRate: number;
  samples: number;
};
export function encodeVoicePcm(
  channels: Float32Array[],
  sampleRate: number,
): Uint8Array<ArrayBuffer>;
