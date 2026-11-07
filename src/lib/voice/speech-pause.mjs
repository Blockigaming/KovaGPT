// Client-only energy gate for hands-free voice turns. It never captures,
// retains, sends, or classifies speech contents. Noise alone cannot send turns.
export function createVoiceSilenceGate({
  speechThreshold = 0.018,
  minimumSpeechMs = 180,
  trailingSilenceMs = 1150,
  minimumTurnMs = 550,
} = {}) {
  let initialLoudAt = null;
  let lastLoudAt = null;
  let heardSpeech = false;
  let firstFrameAt = null;

  return {
    sample(rms, now) {
      if (!Number.isFinite(rms) || !Number.isFinite(now) || rms < 0) return false;
      if (firstFrameAt === null) firstFrameAt = now;
      if (rms >= speechThreshold) {
        if (initialLoudAt === null) initialLoudAt = now;
        lastLoudAt = now;
        if (now - initialLoudAt >= minimumSpeechMs) heardSpeech = true;
        return false;
      }
      if (!heardSpeech && initialLoudAt !== null) initialLoudAt = null;
      return (
        heardSpeech &&
        lastLoudAt !== null &&
        now - lastLoudAt >= trailingSilenceMs &&
        now - firstFrameAt >= minimumTurnMs
      );
    },
    hasSpeech() {
      return heardSpeech;
    },
  };
}
