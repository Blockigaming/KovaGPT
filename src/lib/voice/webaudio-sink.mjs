// Gapless streaming playback for browsers without MP3 MediaSource (notably
// iPhone Safari, which only offers ManagedMediaSource and blocks play() that is
// not started from a tap). Each spoken segment is decoded as soon as it has
// fully arrived and scheduled back-to-back on one AudioContext, so speech still
// starts at the first segment instead of waiting for the whole reply.
// Signed live segments can also use 24 kHz mono PCM to play without waiting
// for complete compressed audio. Prerecorded MP3s use the same output queue.
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
  let pcmTail = new Uint8Array(0);
  const PCM_RATE = 24000;
  const PCM_BLOCK_BYTES = 3840; // 80 ms, signed 16-bit mono
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

  const scheduleAudio = async (audio) => {
    if (disposed || signal.aborted) return;
    if (context.state !== "running") await context.resume?.().catch(() => undefined);
    if (disposed || signal.aborted) return;
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

  const enqueue = (makeAudio) => {
    decoding = decoding
      .then(async () => {
        if (!disposed && !signal.aborted) await scheduleAudio(await makeAudio());
      })
      .catch(() => {
        if (!disposed && !signal.aborted) onError();
      });
  };
  const enqueuePcm = (bytes) => {
    enqueue(() => {
      const audio = context.createBuffer(1, bytes.byteLength / 2, PCM_RATE);
      const samples = audio.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
      return audio;
    });
  };

  return {
    async write(bytes) {
      signal.throwIfAborted();
      chunks.push(bytes);
    },
    async writePcm(bytes) {
      signal.throwIfAborted();
      const joined = new Uint8Array(pcmTail.byteLength + bytes.byteLength);
      joined.set(pcmTail);
      joined.set(bytes, pcmTail.byteLength);
      let offset = 0;
      while (joined.byteLength - offset >= PCM_BLOCK_BYTES) {
        enqueuePcm(joined.slice(offset, offset + PCM_BLOCK_BYTES));
        offset += PCM_BLOCK_BYTES;
      }
      pcmTail = joined.slice(offset);
    },
    /** Finish either a compressed clip or the final short PCM block. */
    async segmentEnd() {
      signal.throwIfAborted();
      if (pcmTail.byteLength) {
        if (pcmTail.byteLength % 2 !== 0) throw new Error("speech_invalid_pcm");
        enqueuePcm(pcmTail);
        pcmTail = new Uint8Array(0);
      }
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
      enqueue(() => decode(joined));
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
      pcmTail = new Uint8Array(0);
    },
  };
}
