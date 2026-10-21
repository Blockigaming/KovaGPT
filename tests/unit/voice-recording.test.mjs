import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { inspectVoicePcm } from "../../src/lib/voice-pcm.mjs";
const source = await readFile(new URL("../../src/lib/voice-recording.ts", import.meta.url), "utf8");
const js = ts.transpileModule(
  source.replace(
    "@/lib/voice-pcm.mjs",
    new URL("../../src/lib/voice-pcm.mjs", import.meta.url).href,
  ),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText;
const { prepareVoiceRecording } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
const recorded = new Blob(["synthetic-local-recorder-fixture"], { type: "audio/webm" });
const decoded = () => ({
  duration: 1,
  numberOfChannels: 1,
  sampleRate: 48000,
  length: 48000,
  getChannelData: () => new Float32Array(48000),
});
function withAudioContext(decode, close = async () => {}) {
  let closed = 0;
  let constructed = 0;
  globalThis.window = {
    AudioContext: class {
      constructor() {
        constructed++;
        this.state = "suspended";
      }
      async decodeAudioData(bytes) {
        assert.ok(bytes instanceof ArrayBuffer);
        return decode();
      }
      async close() {
        closed++;
        await close();
        this.state = "closed";
      }
    },
  };
  return {
    get closed() {
      return closed;
    },
    get constructed() {
      return constructed;
    },
  };
}
test("normalizer creates canonical PCM WAV and closes decode context", async () => {
  const fixture = withAudioContext(decoded);
  try {
    const result = await prepareVoiceRecording(recorded);
    assert.equal(result.type, "audio/wav");
    assert.equal(inspectVoicePcm(new Uint8Array(await result.arrayBuffer())).durationSeconds, 1);
    assert.equal(fixture.closed, 1);
    assert.equal(await recorded.text(), "synthetic-local-recorder-fixture");
  } finally {
    delete globalThis.window;
  }
});
test("bounds input before decode context allocation", async () => {
  const fixture = withAudioContext(decoded);
  try {
    await assert.rejects(prepareVoiceRecording(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)])));
    assert.equal(fixture.constructed, 0);
  } finally {
    delete globalThis.window;
  }
});
test("rejects overlong decoded recording before channel access and preserves original", async () => {
  let accessed = false;
  const fixture = withAudioContext(() => ({
    ...decoded(),
    duration: 61,
    length: 48000 * 61,
    getChannelData: () => {
      accessed = true;
      throw new Error("must not copy");
    },
  }));
  try {
    await assert.rejects(prepareVoiceRecording(recorded), /Your recording is still available/);
    assert.equal(accessed, false);
    assert.equal(fixture.closed, 1);
    assert.ok(recorded.size > 0);
  } finally {
    delete globalThis.window;
  }
});
test("abort during decoder wait closes context and discards result", async () => {
  let resolve;
  const pending = new Promise((r) => {
    resolve = r;
  });
  const fixture = withAudioContext(() => pending);
  const controller = new AbortController();
  try {
    const operation = prepareVoiceRecording(recorded, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    resolve(decoded());
    await assert.rejects(operation, { name: "AbortError" });
    assert.equal(fixture.closed, 1);
  } finally {
    delete globalThis.window;
  }
});
test("abort settles while decoder and context cleanup are still pending and ignores late decode", async () => {
  let resolveDecode, resolveClose;
  let channelAccessed = false;
  const decoding = new Promise((resolve) => (resolveDecode = resolve));
  const cleanup = new Promise((resolve) => (resolveClose = resolve));
  const fixture = withAudioContext(
    () => decoding,
    () => cleanup,
  );
  const controller = new AbortController();
  try {
    const result = prepareVoiceRecording(recorded, { signal: controller.signal }).catch(
      (error) => error,
    );
    await new Promise(setImmediate);
    controller.abort();
    const aborted = await Promise.race([
      result,
      new Promise((resolve) => setImmediate(() => resolve("still pending"))),
    ]);
    assert.equal(aborted?.name, "AbortError");
    assert.equal(fixture.closed, 1, "Abort closes the context once without awaiting it");
    resolveDecode({
      ...decoded(),
      getChannelData() {
        channelAccessed = true;
        return new Float32Array(48000);
      },
    });
    resolveClose();
    await new Promise(setImmediate);
    assert.equal(channelAccessed, false, "Late decoding cannot prepare or send cancelled audio");
    assert.equal(fixture.closed, 1);
  } finally {
    resolveClose();
    delete globalThis.window;
  }
});
test("abort settles during a stalled recording read before browser decoding", async () => {
  let decodeCalls = 0;
  const fixture = withAudioContext(() => {
    decodeCalls++;
    return decoded();
  });
  const audio = new Blob(["recorded bytes"], { type: "audio/webm" });
  Object.defineProperty(audio, "arrayBuffer", { value: () => new Promise(() => {}) });
  const controller = new AbortController();
  try {
    const result = prepareVoiceRecording(audio, { signal: controller.signal }).catch(
      (error) => error,
    );
    controller.abort();
    const aborted = await Promise.race([
      result,
      new Promise((resolve) => setImmediate(() => resolve("still pending"))),
    ]);
    assert.equal(aborted?.name, "AbortError");
    assert.equal(decodeCalls, 0);
    assert.equal(fixture.closed, 1);
  } finally {
    delete globalThis.window;
  }
});
test("abort also settles if browser context cleanup stalls after successful decoding", async () => {
  let resolveClose;
  const fixture = withAudioContext(
    decoded,
    () => new Promise((resolve) => (resolveClose = resolve)),
  );
  const controller = new AbortController();
  try {
    const result = prepareVoiceRecording(recorded, { signal: controller.signal }).catch(
      (error) => error,
    );
    await new Promise(setImmediate);
    assert.equal(fixture.closed, 1);
    controller.abort();
    const aborted = await Promise.race([
      result,
      new Promise((resolve) => setImmediate(() => resolve("still pending"))),
    ]);
    assert.equal(aborted?.name, "AbortError");
    assert.equal(fixture.closed, 1);
  } finally {
    resolveClose?.();
    delete globalThis.window;
  }
});
test("decoder failure has useful safe error and preserves original", async () => {
  const fixture = withAudioContext(() => {
    throw new Error("decoder internals");
  });
  try {
    await assert.rejects(prepareVoiceRecording(recorded), /Your recording is still available/);
    assert.equal(fixture.closed, 1);
    assert.ok(recorded.size > 0);
  } finally {
    delete globalThis.window;
  }
});
