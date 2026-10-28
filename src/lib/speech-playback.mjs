const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
let stopActive = null;
let playbackEpoch = 0;

// A microphone session must not record audio from a response that is still
// speaking. Reuse the active player's ordinary Stop path and state cleanup.
export function stopActiveSpeechPlayback() {
  stopActive?.();
}

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

async function speechFailureCode(response, run) {
  if (response.status === 403) {
    if (!response.body) return "speech_forbidden";
    const reader = response.body.getReader();
    run.reader = reader;
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024) {
          void reader.cancel().catch(() => undefined);
          return "speech_forbidden";
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const code = JSON.parse(new TextDecoder().decode(bytes))?.error;
      if (code === "speech_model_not_eligible") return "speech_not_eligible";
      if (code === "speech_voice_plan_required") return "speech_voice_plan_required";
    } catch {
      // Unknown upstream errors must never be described as a model verdict.
    }
    return "speech_forbidden";
  }
  void response.body?.cancel().catch(() => undefined);
  const codes = {
    401: "speech_unauthorized",
    404: "speech_message_unavailable",
    409: "speech_message_not_synced",
    413: "speech_text_too_long",
    429: "speech_limit_reached",
    503: "speech_not_available",
  };
  return codes[response.status] ?? "speech_unavailable";
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
  onEnded,
}) {
  let current = null;
  const stop = () => {
    playbackEpoch++;
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
    const requestInput = Object.freeze({ ...input });
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
          if (!live()) return;
          const endedEpoch = playbackEpoch + 1;
          stop();
          // The idle callback may itself Stop, change account/chat, or start
          // another player. Only the still-current natural ending can advance
          // a voice turn; fetched bytes and ordinary Stop never call onEnded.
          if (playbackEpoch === endedEpoch) onEnded?.(requestInput);
        },
        onError: () => fail("speech_playback_failed"),
      });
      const response = await fetchImpl("/api/speech", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Kova-Owner": requestInput.ownerId },
        body: JSON.stringify(requestInput),
        signal: run.controller.signal,
      });
      if (!live()) {
        void response.body?.cancel().catch(() => undefined);
        return;
      }
      if (!response.ok) {
        // Only exact server codes identify a model or plan denial.
        throw new Error(await speechFailureCode(response, run));
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
        "speech_not_eligible",
        "speech_voice_plan_required",
        "speech_forbidden",
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
