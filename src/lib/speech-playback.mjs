const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
let stopActive = null;

function eventOnce(target, event, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(event, done);
      target.removeEventListener("error", bad);
      signal.removeEventListener("abort", bad);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error("speech_playback_failed"));
    };
    if (signal.aborted) {
      bad();
      return;
    }
    target.addEventListener(event, done, { once: true });
    target.addEventListener("error", bad, { once: true });
    signal.addEventListener("abort", bad, { once: true });
  });
}

// MP3 MediaSource plays while bytes arrive. Browsers without it use a bounded
// Blob fallback; Stop cancels either path. No audio or response text is persisted.
export function createBrowserSpeechSink({ signal, onPlaying, onEnded, onError }) {
  const audio = new Audio();
  audio.onplaying = onPlaying;
  audio.onended = onEnded;
  audio.onerror = onError;
  let url, source, buffer;
  const chunks = [];
  const mse = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg");
  let ready = Promise.resolve();
  const play = () => {
    void audio.play().catch(() => {
      if (!signal.aborted) onError();
    });
  };
  if (mse) {
    source = new MediaSource();
    ready = eventOnce(source, "sourceopen", signal).then(() => {
      buffer = source.addSourceBuffer("audio/mpeg");
    });
    void ready.catch(() => undefined);
    url = URL.createObjectURL(source);
    audio.src = url;
    play();
  }
  return {
    async write(bytes) {
      await ready;
      signal.throwIfAborted();
      if (!mse) {
        chunks.push(bytes);
        return;
      }
      const appended = eventOnce(buffer, "updateend", signal);
      void appended.catch(() => undefined);
      buffer.appendBuffer(bytes);
      await appended;
    },
    async end() {
      await ready;
      signal.throwIfAborted();
      if (mse) {
        if (source.readyState === "open") source.endOfStream();
      } else {
        url = URL.createObjectURL(new Blob(chunks, { type: "audio/mpeg" }));
        audio.src = url;
        play();
      }
    },
    dispose() {
      audio.onplaying = audio.onended = audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (url) URL.revokeObjectURL(url);
      chunks.length = 0;
      // A Stop before sourceopen must not create an unhandled rejection.
      void ready.catch(() => undefined);
    },
  };
}

export function createSpeechPlayback({
  fetchImpl = fetch,
  createSink = createBrowserSpeechSink,
  onState,
}) {
  let current = null;
  const stop = () => {
    const old = current;
    current = null;
    if (stopActive === stop) stopActive = null;
    if (old) {
      old.controller.abort();
      clearTimeout(old.timer);
      clearTimeout(old.requestTimer);
      void old.reader?.cancel().catch(() => undefined);
      old.sink?.dispose();
    }
    onState("idle");
  };
  const start = async (input) => {
    stopActive?.();
    stop();
    stopActive = stop;
    const run = {
      controller: new AbortController(),
      sink: null,
      reader: null,
      timer: null,
      requestTimer: null,
    };
    current = run;
    const live = () => current === run && !run.controller.signal.aborted;
    const fail = (code) => {
      if (!live()) return;
      stop();
      onState("error", code);
    };
    onState("loading");
    // Includes loading and playback; no abandoned audio may play indefinitely.
    run.timer = setTimeout(() => fail("speech_timeout"), 600000);
    run.requestTimer = setTimeout(() => fail("speech_timeout"), 60000);
    try {
      run.sink = createSink({
        signal: run.controller.signal,
        onPlaying: () => {
          if (live()) onState("playing");
        },
        onEnded: () => {
          if (live()) stop();
        },
        onError: () => fail("speech_playback_failed"),
      });
      const response = await fetchImpl("/api/speech", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Kova-Owner": input.ownerId },
        body: JSON.stringify(input),
        signal: run.controller.signal,
      });
      if (!live()) {
        void response.body?.cancel().catch(() => undefined);
        return;
      }
      if (!response.ok) {
        // Never reflect an upstream body or arbitrary error string into the UI.
        const codes = {
          401: "speech_unauthorized",
          403: "speech_unauthorized",
          404: "speech_message_unavailable",
          409: "speech_message_not_synced",
          413: "speech_text_too_long",
          429: "speech_limit_reached",
          503: "speech_not_available",
        };
        void response.body?.cancel().catch(() => undefined);
        throw new Error(codes[response.status] ?? "speech_unavailable");
      }
      if (!response.body || response.headers.get("content-type")?.split(";", 1)[0] !== "audio/mpeg")
        throw new Error("speech_unavailable");
      run.reader = response.body.getReader();
      let total = 0;
      while (live()) {
        const { done, value } = await run.reader.read();
        if (!live()) return;
        if (done) break;
        total += value.byteLength;
        if (total > MAX_AUDIO_BYTES) throw new Error("speech_unavailable");
        await run.sink.write(value);
      }
      if (live()) {
        clearTimeout(run.requestTimer);
        if (!total) throw new Error("speech_unavailable");
        await run.sink.end();
      }
    } catch (error) {
      const allowed = new Set([
        "speech_unauthorized",
        "speech_message_unavailable",
        "speech_message_not_synced",
        "speech_text_too_long",
        "speech_limit_reached",
        "speech_not_available",
      ]);
      fail(allowed.has(error?.message) ? error.message : "speech_unavailable");
    }
  };
  return { start, stop };
}
