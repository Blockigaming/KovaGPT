// Gapless streaming playback for browsers without MP3 MediaSource (notably
// iPhone Safari, which only offers ManagedMediaSource and blocks play() that is
// not started from a tap). Each spoken segment is decoded as soon as it has
// fully arrived and scheduled back-to-back on one AudioContext, so speech still
// starts at the first segment instead of waiting for the whole reply.
let sharedContext = null;

const contextClass = () => globalThis.AudioContext ?? globalThis.webkitAudioContext;

/** True when the MediaSource sink can stream MP3 (desktop Chrome, Firefox, Safari, Android). */
export function supportsStreamingMp3() {
  return (
    typeof globalThis.MediaSource !== "undefined" &&
    globalThis.MediaSource.isTypeSupported?.("audio/mpeg") === true
  );
}

/**
 * Call synchronously from a user tap (opening Voice). iOS only lets an
 * AudioContext make sound after it was resumed inside a gesture; the same
 * context is reused for every later reply in the session.
 */
export function primeVoiceAudio() {
  try {
    const AudioContextClass = contextClass();
    if (!AudioContextClass) return;
    if (!sharedContext || sharedContext.state === "closed") sharedContext = new AudioContextClass();
    void sharedContext.resume?.();
    const unlock = sharedContext.createBufferSource();
    unlock.buffer = sharedContext.createBuffer(1, 1, 22050);
    unlock.connect(sharedContext.destination);
    unlock.start(0);
  } catch {
    // Audio unlock is best effort; playback reports its own error if blocked.
  }
}

export function createWebAudioSegmentSink({
  signal,
  onPlaying,
  onEnded,
  onError,
  onLevel,
  onProgress,
}) {
  const AudioContextClass = contextClass();
  if (!AudioContextClass) {
    queueMicrotask(() => !signal.aborted && onError());
    return { async write() {}, async segmentEnd() {}, async end() {}, dispose() {} };
  }
  if (!sharedContext || sharedContext.state === "closed") sharedContext = new AudioContextClass();
  const context = sharedContext;
  const output = context.createAnalyser();
  output.fftSize = 256;
  output.connect(context.destination);
  let chunks = [];
  let decoding = Promise.resolve();
  let nextStart = 0;
  let firstStart = null;
  let pending = 0;
  let endRequested = false;
  let disposed = false;
  let started = false;
  let frame;
  const sources = new Set();

  const sample = () => {
    if (disposed) return;
    if (onLevel) {
      const samples = new Float32Array(output.fftSize);
      output.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const value of samples) energy += value * value;
      onLevel(Math.sqrt(energy / samples.length));
    }
    if (onProgress && firstStart !== null)
      onProgress(Math.max(0, context.currentTime - firstStart), Number.POSITIVE_INFINITY);
    frame = requestAnimationFrame(sample);
  };

  const finishIfDone = () => {
    if (!disposed && endRequested && pending === 0) onEnded();
  };

  const decode = (bytes) =>
    new Promise((resolve, reject) => {
      // Callback form works on every Safari; the promise form is not universal.
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      context.decodeAudioData(copy, resolve, reject);
    });

  const schedule = async (bytes) => {
    const audio = await decode(bytes);
    if (disposed || signal.aborted) return;
    if (context.state !== "running") await context.resume?.().catch(() => undefined);
    const source = context.createBufferSource();
    source.buffer = audio;
    source.connect(output);
    const startAt = Math.max(context.currentTime + 0.03, nextStart);
    nextStart = startAt + audio.duration;
    pending++;
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      pending--;
      finishIfDone();
    };
    source.start(startAt);
    if (!started) {
      started = true;
      firstStart = startAt;
      onPlaying();
      if (onLevel || onProgress) frame = requestAnimationFrame(sample);
    }
  };

  return {
    async write(bytes) {
      signal.throwIfAborted();
      chunks.push(bytes);
    },
    /** One complete MP3 (a segment or an acknowledgment) has been written. */
    async segmentEnd() {
      signal.throwIfAborted();
      if (!chunks.length) return;
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      chunks = [];
      // Decode in order so segments are scheduled in order.
      decoding = decoding
        .then(() => schedule(joined))
        .catch(() => {
          if (!disposed && !signal.aborted) onError();
        });
    },
    async end() {
      signal.throwIfAborted();
      // The whole-reply fallback supplies a single complete MP3 and calls
      // end() without segmentEnd(). Flush it before closing the sink.
      await this.segmentEnd();
      await decoding;
      if (disposed || signal.aborted) return;
      // Do not report completion while the last segment is still decoding.
      endRequested = true;
      finishIfDone();
    },
    dispose() {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      for (const source of sources) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      }
      sources.clear();
      try {
        output.disconnect();
      } catch {
        // Already disconnected.
      }
      chunks = [];
    },
  };
}
