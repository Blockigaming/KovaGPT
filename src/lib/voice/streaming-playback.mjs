// Plays a reply as it is generated: signed segments are fetched in parallel,
// written in order into one gapless sink, and an optional pre-generated
// acknowledgment is written first only when a real delay occurs. Because every
// byte goes through the single sink, an acknowledgment can never overlap the
// real response, and Stop silences everything at once.
import { createAcknowledgmentPolicy } from "./acknowledgments.mjs";

const MAX_IN_FLIGHT = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const STATUS_CODES = {
  401: "speech_unauthorized",
  403: "speech_not_eligible",
  409: "speech_message_not_synced",
  413: "speech_text_too_long",
  429: "speech_limit_reached",
  503: "speech_not_available",
};

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const REASONING_MODES = ["thinking", "high", "extra_high", "max", "ultra"];
const RECEIPT = /^[A-Za-z0-9_-]{1,1800}\.[A-Za-z0-9_-]{43}$/u;

/** Validate a stream delta; returns the signed segment it carries, else null. */
export function parseVoiceSegment(delta) {
  if (
    delta?.kind !== "voice_segment" ||
    typeof delta.chatId !== "string" ||
    typeof delta.messageId !== "string" ||
    !delta.chatId ||
    !delta.messageId ||
    delta.chatId.length > 200 ||
    delta.messageId.length > 200 ||
    !Number.isSafeInteger(delta.index) ||
    typeof delta.text !== "string" ||
    !delta.text ||
    delta.text.length > 1000 ||
    typeof delta.receipt !== "string" ||
    !RECEIPT.test(delta.receipt)
  )
    return null;
  return {
    chatId: delta.chatId,
    messageId: delta.messageId,
    index: delta.index,
    text: delta.text,
    receipt: delta.receipt,
  };
}

/** A reasoning mode predicts a delay (a hint only; it never selects a model or effort). */
export function predictedDelay(mode) {
  return REASONING_MODES.includes(mode) ? "reasoning" : null;
}

export function createStreamingVoicePlayback({
  ownerId,
  voiceId,
  fetchImpl = fetch,
  createSink,
  ackCache,
  tracker,
  policy = createAcknowledgmentPolicy(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => performance.now(),
  onState = () => {},
  onEnded = () => {},
  onLevel,
}) {
  let controller = null;
  let sink = null;
  let timer = null;
  let live = false;
  let segments = [];
  let nextWrite = 0;
  let inFlight = 0;
  let queue = [];
  let closed = false;
  let pumping = false;
  let ended = false;
  let wroteAnything = false;
  let ackAudibleAt = null;
  let ackDurationMs = 0;
  let realDispatched = false;
  let realAudioReady = false;
  let substantiveMarked = false;
  let sinkPlaying = false;
  let writeChain = Promise.resolve();
  let startedAt = 0;

  // The clip's due time depends on the reason, which may be learned after begin().
  const arm = () => {
    clearTimer(timer);
    const remaining = Math.max(0, startedAt + policy.delayMs - now());
    timer = setTimer(() => void fireAcknowledgment(), remaining);
  };

  const fail = (code) => {
    if (!live) return;
    stop(false);
    onState("error", code);
  };

  const markSubstantive = () => {
    if (substantiveMarked) return;
    substantiveMarked = true;
    if (ackAudibleAt !== null) {
      const wait = Math.max(0, ackAudibleAt + ackDurationMs - now());
      const epoch = controller;
      setTimer(() => {
        if (live && controller === epoch) tracker?.audible({ substantive: true });
      }, wait);
    } else if (sinkPlaying) tracker?.audible({ substantive: true });
    // Otherwise onPlaying reports it, because no acknowledgment is ahead of it.
  };

  const write = (bytes) => {
    writeChain = writeChain.then(() => {
      if (!live) return;
      return sink.write(bytes);
    });
    return writeChain;
  };
  // One complete MP3 has been written. Sinks that cannot stream partial MP3 (Web
  // Audio on iOS) decode and schedule it here; streaming sinks ignore it.
  const segmentEnd = () => {
    writeChain = writeChain.then(() => {
      if (!live) return;
      return sink.segmentEnd?.();
    });
    return writeChain;
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (live) {
        const item = segments[nextWrite];
        if (!item) break;
        const response = await item.response;
        if (!live) return;
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new Error(STATUS_CODES[response.status] ?? "speech_unavailable");
        }
        if (
          !response.body ||
          response.headers.get("content-type")?.split(";", 1)[0] !== "audio/mpeg"
        )
          throw new Error("speech_unavailable");
        item.reader = response.body.getReader();
        let total = 0;
        while (live) {
          const { done, value } = await item.reader.read();
          if (!live) return;
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BYTES) throw new Error("speech_unavailable");
          if (!value.byteLength) continue;
          // A signed segment is only text authorization. TTS/network latency
          // can still leave the user waiting; suppress fillers on actual audio.
          if (!realAudioReady) {
            realAudioReady = true;
            policy.realSpeechStarted();
            clearTimer(timer);
            timer = null;
          }
          if (!wroteAnything) wroteAnything = true;
          await write(value);
          if (nextWrite === 0) markSubstantive();
        }
        if (!total) throw new Error("speech_unavailable");
        await segmentEnd();
        nextWrite++;
      }
      if (live && closed && nextWrite >= segments.length && !ended) {
        ended = true;
        await writeChain;
        if (live) await sink.end();
      }
    } catch (error) {
      fail(
        typeof error?.message === "string" && error.message.startsWith("speech_")
          ? error.message
          : "speech_unavailable",
      );
    } finally {
      pumping = false;
    }
  };

  const launch = () => {
    while (live && inFlight < MAX_IN_FLIGHT && queue.length) {
      const item = queue.shift();
      inFlight++;
      item.response = (async () => {
        const body = {
          ownerId,
          chatId: item.chatId,
          messageId: item.messageId,
          mode: "live-segment",
          segmentIndex: item.index,
          text: item.text,
          contentSha256: await sha256Hex(item.text),
          segmentReceipt: item.receipt,
          ...(voiceId ? { voiceId } : {}),
        };
        return fetchImpl("/api/speech", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "X-Kova-Owner": ownerId },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      })();
      const release = () => {
        inFlight--;
        launch();
      };
      // Free the slot as soon as response headers arrive; bytes keep streaming.
      item.response.then(release, release);
      item.response.catch(() => undefined);
    }
    void pump();
  };

  const fireAcknowledgment = async () => {
    timer = null;
    const kind = policy.due();
    if (!kind || !live || closed || realAudioReady || !ackCache) return;
    const clip = await ackCache.get(voiceId, kind);
    // Real audio may have arrived while the clip loaded; then skip it.
    if (!clip || !live || closed || realAudioReady || wroteAnything) return;
    wroteAnything = true;
    ackDurationMs = clip.durationMs;
    ackAudibleAt = now();
    // Queue the complete clip as one operation. A reply arriving during the
    // write must not append its bytes before the acknowledgment boundary.
    writeChain = writeChain.then(async () => {
      if (!live) return;
      await sink.write(clip.bytes);
      if (live) await sink.segmentEnd?.();
    });
    await writeChain.catch(() => undefined);
  };

  const stop = (silent = true) => {
    const was = live;
    live = false;
    clearTimer(timer);
    timer = null;
    controller?.abort();
    for (const item of segments) void item.reader?.cancel().catch(() => undefined);
    sink?.dispose();
    sink = null;
    segments = [];
    queue = [];
    if (was) tracker?.interruptSilenced();
    if (silent && was) onState("idle");
  };

  return {
    /** The user's speech ended; open the sink and arm the delayed acknowledgment. */
    begin() {
      stop();
      controller = new AbortController();
      live = true;
      closed = false;
      ended = false;
      segments = [];
      queue = [];
      nextWrite = 0;
      inFlight = 0;
      pumping = false;
      wroteAnything = false;
      ackAudibleAt = null;
      realDispatched = false;
      realAudioReady = false;
      substantiveMarked = false;
      sinkPlaying = false;
      writeChain = Promise.resolve();
      tracker?.speechEnded(now());
      onState("loading");
      sink = createSink({
        signal: controller.signal,
        onLevel,
        onPlaying: () => {
          if (!live) return;
          sinkPlaying = true;
          const substantive = ackAudibleAt === null && realDispatched;
          tracker?.audible({ substantive });
          if (substantive) substantiveMarked = true;
          onState("playing");
        },
        onEnded: () => {
          if (!live) return;
          stop(false);
          onState("idle");
          onEnded();
        },
        onError: () => fail("speech_playback_failed"),
      });
      startedAt = now();
      arm();
    },
    /** A search or extended-reasoning delay was detected for this turn. */
    delay(kind) {
      policy.reason(kind);
      if (live && timer && !realAudioReady) arm();
    },
    /** One signed segment from the chat stream; speaks as soon as bytes arrive. */
    segment({ chatId, messageId, index, text, receipt }) {
      if (!live || closed) return;
      realDispatched = true;
      const item = { chatId, messageId, index, text, receipt, response: null, reader: null };
      segments[index] = item;
      queue.push(item);
      launch();
    },
    /** No more segments will arrive. Returns false when nothing was ever spoken. */
    finish() {
      if (!live) return false;
      closed = true;
      if (!segments.length) {
        // An acknowledgment is not the answer. Stop it and let the caller
        // synthesize the authenticated complete reply instead.
        stop(false);
        onState("idle");
        return false;
      }
      void pump();
      return true;
    },
    stop: () => stop(true),
    /** The user spoke over Kova: stop now and record how long silencing took. */
    interrupt() {
      tracker?.interruptRequested();
      stop(true);
    },
    get active() {
      return live;
    },
  };
}
