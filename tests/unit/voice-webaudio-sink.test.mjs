import assert from "node:assert/strict";
import test from "node:test";
let instance = 0;
// A fresh module instance per test so the shared AudioContext starts clean.
const load = () => import(`../../src/lib/voice/webaudio-sink.mjs?case=${++instance}`);

function installAudio({ decodeFails = false } = {}) {
  const log = { started: [], stopped: 0, resumed: 0, decoded: [], contexts: 0 };
  const sources = [];
  class FakeContext {
    constructor() {
      log.contexts++;
      this.state = "suspended";
      this.currentTime = 10;
      this.destination = {};
    }
    resume() {
      log.resumed++;
      this.state = "running";
      return Promise.resolve();
    }
    createBuffer(_channels, length, rate) {
      const samples = new Float32Array(length);
      return { duration: length / rate, getChannelData: () => samples };
    }
    createAnalyser() {
      return {
        fftSize: 0,
        connect() {},
        disconnect() {},
        getFloatTimeDomainData(samples) {
          samples.fill(0.5);
        },
      };
    }
    createBufferSource() {
      const source = {
        buffer: null,
        connect() {},
        start(at) {
          log.started.push(at);
        },
        stop() {
          log.stopped++;
        },
        onended: null,
      };
      sources.push(source);
      return source;
    }
    decodeAudioData(bytes, ok, fail) {
      log.decoded.push(bytes.byteLength);
      if (decodeFails) fail(new Error("bad"));
      else ok({ duration: 1.5 });
    }
  }
  globalThis.AudioContext = FakeContext;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  return { log, sources };
}
const events = () => {
  const e = { playing: 0, ended: 0, errors: 0 };
  return {
    e,
    options: {
      signal: new AbortController().signal,
      onPlaying: () => e.playing++,
      onEnded: () => e.ended++,
      onError: () => e.errors++,
    },
  };
};
const settle = () => new Promise((r) => setTimeout(r, 5));

test("iPhone-style browsers (no MP3 MediaSource) use the Web Audio path", async () => {
  const { supportsStreamingMp3 } = await load();
  delete globalThis.MediaSource;
  assert.equal(supportsStreamingMp3(), false);
  globalThis.MediaSource = { isTypeSupported: (t) => t === "audio/mpeg" };
  assert.equal(supportsStreamingMp3(), true);
  delete globalThis.MediaSource;
});

test("segments are decoded as they complete, scheduled gaplessly in order, and playback starts at the first", async () => {
  const { createWebAudioSegmentSink, primeVoiceAudio } = await load();
  const { log } = installAudio();
  primeVoiceAudio();
  assert.ok(log.resumed >= 1, "context is resumed inside the tap");
  const { e, options } = events();
  const sink = createWebAudioSegmentSink(options);
  await sink.write(new Uint8Array(3));
  await sink.write(new Uint8Array(2));
  await sink.segmentEnd();
  await settle();
  assert.deepEqual(log.decoded, [5]);
  assert.equal(e.playing, 1);
  await sink.write(new Uint8Array(4));
  await sink.segmentEnd();
  await settle();
  // The first start is the silent unlock played inside the tap.
  const starts = log.started.slice(1);
  assert.equal(starts.length, 2);
  assert.ok(
    Math.abs(starts[1] - (starts[0] + 1.5)) < 1e-9,
    "second segment starts exactly when the first ends",
  );
  assert.equal(e.playing, 1);
  assert.equal(log.contexts, 1, "one context is reused");
});

test("ended fires only after the last scheduled segment finishes", async () => {
  const { createWebAudioSegmentSink, primeVoiceAudio } = await load();
  const { sources } = installAudio();
  const { e, options } = events();
  const sink = createWebAudioSegmentSink(options);
  await sink.write(new Uint8Array(3));
  await sink.segmentEnd();
  await sink.write(new Uint8Array(3));
  await sink.segmentEnd();
  await sink.end();
  assert.equal(e.ended, 0);
  sources.at(-2).onended();
  assert.equal(e.ended, 0);
  sources.at(-1).onended();
  assert.equal(e.ended, 1);
});

test("dispose stops every scheduled source immediately and never reports ended", async () => {
  const { createWebAudioSegmentSink, primeVoiceAudio } = await load();
  const { log, sources } = installAudio();
  const { e, options } = events();
  const sink = createWebAudioSegmentSink(options);
  await sink.write(new Uint8Array(3));
  await sink.segmentEnd();
  await sink.write(new Uint8Array(3));
  await sink.segmentEnd();
  await settle();
  sink.dispose();
  assert.equal(log.stopped, 2);
  for (const s of sources) s.onended?.();
  assert.equal(e.ended, 0);
});

test("a decode failure is reported once as a playback error", async () => {
  const { createWebAudioSegmentSink, primeVoiceAudio } = await load();
  installAudio({ decodeFails: true });
  const { e, options } = events();
  const sink = createWebAudioSegmentSink(options);
  await sink.write(new Uint8Array(3));
  await sink.segmentEnd();
  await settle();
  assert.equal(e.errors, 1);
  assert.equal(e.playing, 0);
});

test("whole-reply fallback decodes buffered MP3 at end and waits for actual playback", async () => {
  const { createWebAudioSegmentSink } = await load();
  const { log, sources } = installAudio();
  const { e, options } = events();
  const sink = createWebAudioSegmentSink(options);
  await sink.write(new Uint8Array(3));
  await sink.write(new Uint8Array(5));
  await sink.end();
  assert.deepEqual(log.decoded, [8]);
  assert.equal(e.playing, 1);
  assert.equal(e.ended, 0);
  sources.at(-1).onended();
  assert.equal(e.ended, 1);
});

test("PCM starts before the segment ends and preserves incomplete samples between network chunks", async () => {
  const { createWebAudioSegmentSink } = await load();
  const { log, sources } = installAudio();
  const { e, options } = events();
  const sink = createWebAudioSegmentSink(options);
  await sink.writePcm(new Uint8Array(3839));
  await settle();
  assert.equal(e.playing, 0);
  await sink.writePcm(new Uint8Array([0, 0, 128]));
  await settle();
  assert.equal(e.playing, 1);
  assert.equal(log.decoded.length, 0, "PCM never invokes compressed audio decoding");
  assert.equal(sources.length, 1);
  await sink.segmentEnd();
  await sink.end();
  assert.equal(sources.length, 2);
  assert.equal(sources[1].buffer.getChannelData(0)[0], -1);
  assert.equal(e.ended, 0);
  sources[0].onended();
  sources[1].onended();
  assert.equal(e.ended, 1);
});
