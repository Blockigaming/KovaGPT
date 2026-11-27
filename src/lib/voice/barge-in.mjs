// Detects the user speaking over Kova without reacting to Kova's own voice
// leaking from the speakers into the microphone. Echo cancellation already
// removes most of it; on top, mic energy must clearly exceed the energy Kova is
// currently playing, stay above an absolute floor, and persist for holdMs.
export function createBargeInDetector({
  floor = 0.035,
  ratio = 2.5,
  holdMs = 260,
  graceMs = 400,
} = {}) {
  let since = null;
  let startedAt = null;
  return {
    /** Playback started; ignore the first moments while echo cancellation settles. */
    reset(now) {
      since = null;
      startedAt = now;
    },
    /** Feed RMS levels (0..1). Returns true once, when the user is clearly speaking. */
    feed({ mic, playback, now }) {
      if (startedAt === null) startedAt = now;
      if (now - startedAt < graceMs) return false;
      const threshold = Math.max(floor, playback * ratio);
      if (!(mic > threshold)) {
        since = null;
        return false;
      }
      since ??= now;
      return now - since >= holdMs;
    },
  };
}
