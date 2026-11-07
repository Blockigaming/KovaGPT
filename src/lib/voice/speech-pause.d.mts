export type VoiceSilenceGate = {
  sample(rms: number, nowMilliseconds: number): boolean;
  hasSpeech(): boolean;
};
export function createVoiceSilenceGate(options?: {
  speechThreshold?: number;
  minimumSpeechMs?: number;
  trailingSilenceMs?: number;
  minimumTurnMs?: number;
}): VoiceSilenceGate;
