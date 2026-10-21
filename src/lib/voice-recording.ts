import { encodeVoicePcm, MAX_VOICE_SECONDS, MIN_VOICE_SECONDS } from "@/lib/voice-pcm.mjs";
const MAX_ENCODED_BYTES = 8 * 1024 * 1024;
/** Normalize only this UI's bounded MediaRecorder output, never remote URLs.
 * The original Blob remains owned by the caller for retry/download on failure.
 */
export async function prepareVoiceRecording(
  blob: Blob,
  { signal }: { signal?: AbortSignal } = {},
): Promise<Blob> {
  signal?.throwIfAborted();
  if (!blob.size || blob.size > MAX_ENCODED_BYTES)
    throw new Error("Recording must be between 0 and 8 MB.");
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass)
    throw new Error(
      "This browser cannot prepare recorded audio. Your recording is still available.",
    );
  const context = new AudioContextClass();
  let closing: Promise<void> | undefined;
  const closeContext = () => {
    if (!closing)
      closing = context.state === "closed" ? Promise.resolve() : context.close().catch(() => {});
    return closing;
  };
  let rejectAbort!: (reason: unknown) => void;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  // Browser decoding/cleanup promises may not settle when their context closes.
  // Keep Stop and the request deadline responsive even in that case.
  void cancellation.catch(() => {});
  const abort = () => {
    void closeContext();
    rejectAbort(signal?.reason ?? new DOMException("Recording cancelled.", "AbortError"));
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    signal?.throwIfAborted();
    const encoded = await Promise.race([blob.arrayBuffer(), cancellation]);
    signal?.throwIfAborted();
    const decoded = await Promise.race([context.decodeAudioData(encoded), cancellation]);
    signal?.throwIfAborted();
    // Inspect before copying channel buffers or allocating resampled output.
    if (
      decoded.duration < MIN_VOICE_SECONDS ||
      decoded.duration > MAX_VOICE_SECONDS ||
      decoded.numberOfChannels < 1 ||
      decoded.numberOfChannels > 2 ||
      decoded.sampleRate < 8000 ||
      decoded.sampleRate > 192000 ||
      decoded.length > decoded.sampleRate * MAX_VOICE_SECONDS
    )
      throw new Error(
        "Record between 0.1 and 60 seconds of mono or stereo audio. Your recording is still available.",
      );
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) =>
      decoded.getChannelData(index),
    );
    const bytes = encodeVoicePcm(channels, decoded.sampleRate);
    signal?.throwIfAborted();
    return new Blob([bytes], { type: "audio/wav" });
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.message.includes("Your recording")) throw error;
    throw new Error(
      "This recording could not be prepared. Your recording is still available; try again or use a different browser.",
      { cause: error },
    );
  } finally {
    try {
      const closed = closeContext();
      if (!signal?.aborted) await Promise.race([closed, cancellation]);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
}
